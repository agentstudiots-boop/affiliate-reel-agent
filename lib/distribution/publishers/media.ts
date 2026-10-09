import { createHash } from "node:crypto";
import { put } from "../../security/guarded-blob";
import type { MasterContent } from "../master-content";
import { PlatformPublishError } from "../publish";

// Media helpers shared by the platform publishers: bounded download of our own Blob assets and JPEG conversion
// (Instagram and TikTok photo posts accept JPEG/WebP, our renders are PNG). Only Blob-store URLs are read.

export type MediaDeps = { request?: typeof fetch; upload?: typeof put; toJpeg?: (png: Buffer) => Promise<Buffer> };
const MAX_IMAGE = 20 * 1024 * 1024;
const MAX_VIDEO = 300 * 1024 * 1024;

export function ownBlobUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.endsWith(".public.blob.vercel-storage.com") ? url : null;
  } catch { return null; }
}

export async function downloadOwnMedia(value: string | null | undefined, kind: "image" | "video", deps: MediaDeps = {}): Promise<Buffer> {
  const url = ownBlobUrl(value);
  if (!url) throw new PlatformPublishError(true, "Medium liegt nicht im eigenen Blob-Store");
  let response: Response;
  try { response = await (deps.request ?? fetch)(url.href, { redirect: "error", cache: "no-store" }); }
  catch { throw new PlatformPublishError(true, "Medium nicht abrufbar"); }
  if (!response.ok) throw new PlatformPublishError(true, `Medium nicht abrufbar (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > (kind === "image" ? MAX_IMAGE : MAX_VIDEO)) throw new PlatformPublishError(true, "Medium leer oder zu groß");
  return bytes;
}

export async function jpegCopy(master: MasterContent, role: string, deps: MediaDeps = {}): Promise<string> {
  const asset = master.assets.find(item => item.role === role);
  if (!asset?.url) throw new PlatformPublishError(true, `Medium ${role} fehlt`);
  if (asset.mediaType === "image/jpeg") return asset.url;
  const png = await downloadOwnMedia(asset.url, "image", deps);
  const toJpeg = deps.toJpeg ?? (async (input: Buffer) => { const sharp = (await import("sharp")).default; return sharp(input).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer(); });
  const jpeg = await toJpeg(png);
  const sha = createHash("sha256").update(jpeg).digest("hex");
  const blob = await (deps.upload ?? put)(`generated/topics/${master.content_id.replace(/[^A-Za-z0-9_-]/g, "")}/${role.replace(/[^A-Za-z0-9_-]/g, "")}-${sha.slice(0, 32)}.jpg`, jpeg,
    { access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "image/jpeg" });
  return blob.url;
}

export const assetOf = (master: MasterContent, role: string) => master.assets.find(item => item.role === role) ?? null;
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
