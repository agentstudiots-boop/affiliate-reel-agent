import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { assertEffectAllowed } from "../security/runtime-guard";
import { getDatabase, type Database } from "../memory/db";
import { parseJob } from "../content/history";
import { requireProduct } from "../amazon";
import { sendWhatsAppText } from "../whatsapp/client";
import { formatPublishReport, type PlatformOutcome } from "../publishing/report";
import { ensureAutomationSchema } from "../memory/ensure-automation-schema";
import { facebookCaption } from "./facebook-caption";
import { instagramGraph, InstagramPublishFailure } from "./instagram-publisher";

type Graph = Awaited<ReturnType<typeof instagramGraph>>;
export type InstagramImageDeps = {
  db?: Database; graph?: () => Promise<Graph>; send?: typeof sendWhatsAppText;
  loadImage?: (url: string) => Promise<Buffer>; toJpeg?: (png: Buffer) => Promise<Buffer>;
  upload?: (path: string, bytes: Buffer) => Promise<string>; sleep?: (ms: number) => Promise<void>;
};

const SOURCE_PATH = /^\/generated\/facebook\/([0-9a-f-]{36})\/[a-f0-9]{64}\.png$/;
const MAX_BYTES = 20 * 1024 * 1024;

async function defaultLoadImage(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".public.blob.vercel-storage.com") || !SOURCE_PATH.test(url.pathname)) throw new Error("source_image_not_allowed");
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("source_image_unavailable");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("source_image_size");
  return bytes;
}

async function defaultToJpeg(png: Buffer) {
  const { default: sharp } = await import("sharp");
  const image = sharp(png).rotate();
  const meta = await image.metadata();
  const ratio = (meta.width || 0) / (meta.height || 1);
  // Instagram feed images must be between 4:5 and 1.91:1; the approved motif is never cropped.
  if (!meta.width || !meta.height || ratio < 0.8 || ratio > 1.91) throw new Error("aspect_ratio_not_supported");
  return image.flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

async function defaultUpload(path: string, bytes: Buffer) {
  assertEffectAllowed("storage_write");
  const blob = await put(path, bytes, { access: "public", addRandomSuffix: false, contentType: "image/jpeg" });
  return blob.url;
}

// Affiliate image posts: Facebook first, then Instagram under the same approval. Instagram no longer depends on the
// Facebook result (platform isolation in the shared multi-publisher); it needs the explicit approval of this record.
async function report(db: Database, publicationId: string, instagram: PlatformOutcome, note?: string) {
  let facebook: PlatformOutcome = { platform: "facebook", status: "published", url: null };
  try {
    const row = (await db.query("SELECT status,permalink FROM publication_requests WHERE id=$1", [publicationId])).rows[0];
    facebook = { platform: "facebook", status: row?.status === "published" ? "published" : "unknown", url: row?.permalink ? String(row.permalink) : null };
  } catch { /* the report still names Instagram's outcome; Facebook stays without link */ }
  return formatPublishReport({ category: "affiliate", format: "SINGLE_IMAGE", outcomes: [facebook, instagram], note });
}

async function note(send: typeof sendWhatsAppText, text: string) {
  try { await send(text); } catch { console.error(JSON.stringify({ event: "instagram_image_notice_failed" })); }
}

// A definite Graph rejection (HTTP 4xx) delivered nothing; anything else may have published.
const definite = (error: unknown) => error instanceof InstagramPublishFailure && error.httpStatus >= 400 && error.httpStatus < 500;

export async function publishInstagramImage(publicationId: string, deps: InstagramImageDeps = {}) {
  const db = deps.db ?? getDatabase();
  const send = deps.send ?? sendWhatsAppText;
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  await ensureAutomationSchema(db);
  const claimed = await db.query(`INSERT INTO instagram_image_posts(publication_id,status)
    SELECT id,'claimed' FROM publication_requests WHERE id=$1 AND platform='facebook'
      AND status IN ('approved','publishing','published','unknown') AND whatsapp_message_id IS NOT NULL AND decided_at IS NOT NULL
    ON CONFLICT DO NOTHING RETURNING publication_id`, [publicationId]);
  if (!claimed.rows.length) return { status: "skipped" as const };
  const fail = async (status: "failed" | "unknown", phase: string, detail: string) => {
    await db.query("UPDATE instagram_image_posts SET status=$2,error_phase=$3,error_detail=$4,updated_at=now() WHERE publication_id=$1", [publicationId, status, phase, detail.slice(0, 120)]);
    console.error(JSON.stringify({ event: "instagram_image_post", publicationId, status, phase, detail }));
  };
  let phase: InstagramPublishFailure["phase"] | "prepare" = "prepare";
  try {
    const data = await db.query(`SELECT p.image_url,p.caption,p.whatsapp_message_id,p.decided_at,j.snapshot FROM publication_requests p JOIN content_jobs j ON j.id=p.job_id WHERE p.id=$1`, [publicationId]);
    const row = data.rows[0];
    if (!row?.image_url) throw new Error("source_image_missing");
    const job = parseJob(row.snapshot);
    requireProduct(job.opportunity.product);
    const caption = facebookCaption(job);
    // Hard approval binding: Instagram reuses the Facebook approval only for exactly the approved text and image.
    if (caption !== String(row.caption) || !row.whatsapp_message_id || !row.decided_at) throw new Error("approval_mismatch: Text weicht von der Freigabe ab");
    const png = await (deps.loadImage ?? defaultLoadImage)(String(row.image_url));
    const jpeg = await (deps.toJpeg ?? defaultToJpeg)(png);
    const sha = createHash("sha256").update(jpeg).digest("hex");
    const jpegUrl = await (deps.upload ?? defaultUpload)(`generated/instagram/${job.id}/${sha}.jpg`, jpeg);
    await db.query("UPDATE instagram_image_posts SET jpeg_url=$2,updated_at=now() WHERE publication_id=$1", [publicationId, jpegUrl]);
    const graph = await (deps.graph ?? instagramGraph)();
    phase = "container";
    const containerId = await graph.createImage(jpegUrl, caption);
    await db.query("UPDATE instagram_image_posts SET status='container_created',container_id=$2,updated_at=now() WHERE publication_id=$1", [publicationId, containerId]);
    return await finishInstagramImage(publicationId, { db, send, sleep, graph });
  } catch (error) {
    const detail = error instanceof InstagramPublishFailure
      ? `${error.detail}${error.code ? ` code ${error.code}` : ""}${error.httpStatus ? ` http ${error.httpStatus}` : ""}`
      : error instanceof Error ? error.message : "unknown";
    await fail("failed", error instanceof InstagramPublishFailure ? error.phase : phase, detail);
    await note(send, await report(db, publicationId, { platform: "instagram", status: "failed", detail: `${error instanceof InstagramPublishFailure ? error.phase : phase}: ${detail}` },
      "Es wurde nichts doppelt gepostet. Antworte mit „Status“, nach Behebung prüfe ich es erneut."));
    return { status: "failed" as const, detail };
  }
}

// Polls the container, then publishes once. Unknown publish results are never repeated.
export async function finishInstagramImage(publicationId: string, deps: Required<Pick<InstagramImageDeps, "db" | "send" | "sleep">> & { graph: Graph }) {
  const { db, send, sleep, graph } = deps;
  const row = (await db.query("SELECT container_id,status FROM instagram_image_posts WHERE publication_id=$1", [publicationId])).rows[0];
  if (!row?.container_id || !["container_created", "processing"].includes(String(row.status))) return { status: "skipped" as const };
  const containerId = String(row.container_id);
  let state: "FINISHED" | "ERROR" | "PROCESSING" = "PROCESSING";
  for (let attempt = 0; attempt < 8 && state === "PROCESSING"; attempt++) {
    state = await graph.status(containerId);
    if (state === "PROCESSING") await sleep(3000);
  }
  if (state === "ERROR") {
    await db.query("UPDATE instagram_image_posts SET status='failed',error_phase='status',error_detail='container_error',updated_at=now() WHERE publication_id=$1", [publicationId]);
    await note(send, await report(db, publicationId, { platform: "instagram", status: "failed", detail: "Instagram hat das Bild abgelehnt (Container-Fehler)" }));
    return { status: "failed" as const };
  }
  if (state === "PROCESSING") {
    await db.query("UPDATE instagram_image_posts SET status='processing',updated_at=now() WHERE publication_id=$1", [publicationId]);
    await note(send, await report(db, publicationId, { platform: "instagram", status: "processing" }, "Antworte später mit „Status“, dann veröffentliche ich es einmalig."));
    return { status: "processing" as const };
  }
  const attempt = await db.query(`UPDATE instagram_image_posts SET status='publishing',publish_attempted_at=now(),updated_at=now()
    WHERE publication_id=$1 AND status IN ('container_created','processing') RETURNING publication_id`, [publicationId]);
  if (!attempt.rows.length) return { status: "skipped" as const };
  let mediaId: string;
  try { mediaId = await graph.publish(containerId); }
  catch (error) {
    const unknownResult = !definite(error);
    const detail = error instanceof InstagramPublishFailure ? `${error.detail}${error.code ? ` code ${error.code}` : ""}` : "unclassified";
    await db.query("UPDATE instagram_image_posts SET status=$2,error_phase='publish',error_detail=$3,updated_at=now() WHERE publication_id=$1", [publicationId, unknownResult ? "unknown" : "failed", detail.slice(0, 120)]);
    console.error(JSON.stringify({ event: "instagram_image_post", publicationId, status: unknownResult ? "unknown" : "failed", phase: "publish", detail }));
    await note(send, await report(db, publicationId, unknownResult ? { platform: "instagram", status: "unknown" } : { platform: "instagram", status: "failed", detail: `Instagram hat abgelehnt: ${detail}` }));
    return { status: unknownResult ? "unknown" as const : "failed" as const };
  }
  let permalink: string | null = null;
  try { permalink = await graph.permalink(mediaId); } catch { /* the post is live; the link is optional */ }
  await db.query("UPDATE instagram_image_posts SET status='published',media_id=$2,permalink=$3,updated_at=now() WHERE publication_id=$1", [publicationId, mediaId, permalink]);
  console.info(JSON.stringify({ event: "instagram_image_post", publicationId, status: "published", hasPermalink: !!permalink }));
  await note(send, await report(db, publicationId, { platform: "instagram", status: "published", url: permalink }));
  return { status: "published" as const, permalink };
}

// Status command: complete a container that was still processing.
export async function resumeInstagramImages(deps: InstagramImageDeps = {}) {
  const db = deps.db ?? getDatabase();
  const pending = await db.query("SELECT publication_id FROM instagram_image_posts WHERE status IN ('container_created','processing') AND container_id IS NOT NULL AND created_at>now()-interval '48 hours' LIMIT 2");
  if (!pending.rows.length) return 0;
  const graph = await (deps.graph ?? instagramGraph)();
  for (const row of pending.rows) await finishInstagramImage(String(row.publication_id), { db, send: deps.send ?? sendWhatsAppText, sleep: deps.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms))), graph });
  return pending.rows.length;
}
