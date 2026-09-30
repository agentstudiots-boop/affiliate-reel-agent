import { requireProduct, PRODUCT_UNRESOLVED } from "@/lib/amazon";
import { imageProviderStatus } from "@/lib/content/image-provider";
import { runContentJob, runProductScout } from "@/lib/orchestrator";
import { getDatabase, type Database } from "@/lib/memory/db";
import { memoryRepository } from "@/lib/memory/repository";
import type { Opportunity } from "@/lib/content/schema";
import { sendWhatsAppText, WhatsAppRejectedError } from "@/lib/whatsapp/client";
import { dailyNotificationTemplateConfigured, sendDailyNotificationTemplate } from "@/lib/whatsapp/client";
import { parseJob } from "@/lib/content/history";
import { facebookPagePublicationError } from "@/lib/meta/publication-eligibility";
import { imageBrief } from "@/lib/content/image-brief";
import { isPumpkinCarvingProduct } from "@/lib/content/category";
import { AMAZON_IDENTITY_MISSING, findAmazonProductByAsin } from "@/lib/product-resolver";
import { ensureAutomationSchema } from "@/lib/memory/ensure-automation-schema";
import { loadApprovedEditorialCorrections } from "@/lib/whatsapp/language-memory";
import { EDITORIAL_MODEL_ERROR, EDITORIAL_RATE_LIMIT_ERROR } from "@/lib/content/model";
import { createHash } from "node:crypto";
import { releaseProduct, reserveProduct } from "@/lib/daily/product-lock";
import { facebookCaption } from "@/lib/meta/facebook-caption";
import { bathtubMatUseCase, isBathtubMat } from "@/lib/content/bathtub-mat";

async function resolveRequestedProduct(value: string) {
  const asin = /^(?:[A-Z0-9]{10})$/.test(value) ? value : value.match(/^https:\/\/(?:www\.)?amazon\.de\/dp\/([A-Z0-9]{10})\/?$/)?.[1];
  if (!asin) throw new Error("Produkt nur als ASIN oder sauberen Amazon.de/dp/-Link angeben.");
  return findAmazonProductByAsin(asin);
}

export function dailyApprovalMessage(job:ReturnType<typeof parseJob>,day:string) {
  const revision=job.events.map(e=>e.data).reverse().find((data): data is {kind:string;instruction:{requires_new_generation:boolean}} => !!data && typeof data==='object' && 'kind' in data && data.kind==='semantic_revision');
  const costText=revision && !revision.instruction.requires_new_generation
    ? 'um die Textrevision freizugeben. Das bestehende Bild bleibt erhalten; keine neue Bildgenerierung'
    : `um den Content-Plan und eine einmalige kostenpflichtige Bildgenerierung freizugeben (Bildprovider: ${imageProviderStatus().provider || "nicht eingerichtet"}, EUR-Kosten nicht vorab bestätigt)`;
  const summary=job.content?.format==='text'?job.content.body:job.content?.format==='image'?job.content.caption:'';
  if (!job.content || !summary?.trim()) throw new Error("missing_caption");
  const publicCaption=facebookCaption(job);
  const image=job.content?.format==='image';
  const visualBrief=image?`\n\nBildbriefing für das Titelbild:\n${imageBrief(job).split('\n')
    .filter(line=>/^(HAUPTMOTIV|Motiv und Handlung|Bildaufbau und Details|Nebenmotive|Grenzen):|^HAUPTMOTIV/.test(line))
    .map(line=>line.slice(0,line.startsWith('Nebenmotive')?480:line.startsWith('HAUPTMOTIV')?440:line.startsWith('Bildaufbau')?500:300))
    .join('\n')}`:'';
  const referenceNotice=job.mode==='reference' && job.modelCalls>0
    ? 'Der KI-Bildentwurf wurde verworfen. Dies ist ein geprüfter Referenzentwurf; bitte Bildbeschreibung und Text besonders sorgfältig prüfen.\n\n':'';
  const body=`Content-Freigabe · Bildpost ${day}\nProdukt: ${job.opportunity.product.name}\nTitel: ${job.content.title}\nFormat: ${job.content?.format || 'unbekannt'} · Facebook\n\n${referenceNotice}Beitragstext (geplante Facebook-Caption):\n${publicCaption}${visualBrief}\n\nASIN: ${job.opportunity.product.asin}\nProduktlink: ${job.opportunity.product.affiliateUrl}\nAntworte auf DIESE Nachricht mit „Freigeben“, ${costText}. Danach kommt eine ZWEITE WhatsApp für die Veröffentlichung. „Ablehnen“ stoppt den Auftrag, Änderungswünsche bitte als Text. Noch kein Post ist online.`;
  if(body.length>3900)throw Error('daily_approval_too_long');
  return body;
}

export async function sendDailyApproval(jobId: string) {
  const db = getDatabase();
  const record = await db.query(
    `SELECT d.day,j.snapshot FROM daily_drafts d JOIN content_jobs j ON j.id=d.job_id
     WHERE d.job_id=$1 AND d.status='awaiting_approval' AND d.whatsapp_message_id IS NULL`,
    [jobId],
  );
  if (!record.rows[0]) return false;
  const job = parseJob(record.rows[0].snapshot);
  if (job.status !== "awaiting_approval") return false;
  requireProduct(job.opportunity.product, JSON.stringify(job.content));
  const recent = await db.query(
    "SELECT 1 FROM whatsapp_events WHERE wa_id=$1 AND received_at>now()-interval '24 hours' LIMIT 1",
    [(process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "")],
  );
  if (!recent.rows.length) return false;
  const body=dailyApprovalMessage(job,new Date(String(record.rows[0].day)).toISOString().slice(0,10));
  const claimed = await db.query(
    `UPDATE daily_drafts SET whatsapp_send_attempted_at=now() WHERE job_id=$1
     AND status='awaiting_approval' AND whatsapp_message_id IS NULL
     AND whatsapp_send_attempted_at IS NULL RETURNING day`, [jobId],
  );
  if (!claimed.rows.length) return false;
  let messageId:string;
  try{messageId=await sendWhatsAppText(body);}
  catch(error){
    // A definite Meta rejection cannot have delivered a message. An unknown
    // network result remains claimed until the operator explicitly asks Status.
    if(error instanceof WhatsAppRejectedError)await db.query(`UPDATE daily_drafts SET whatsapp_send_attempted_at=NULL,updated_at=now()
      WHERE job_id=$1 AND status='awaiting_approval' AND whatsapp_message_id IS NULL`,[jobId]);
    throw error;
  }
  await db.query("UPDATE daily_drafts SET whatsapp_message_id=$2,updated_at=now() WHERE job_id=$1 AND status='awaiting_approval'", [jobId, messageId]);
  return true;
}



// Inside the 24 h service window the full draft is sent. Outside it only the
// approved notification template goes out; the reply "Entwurf" then fetches the
// stored draft. A template is never a content approval.
async function deliverDailyApproval(db: Database, jobId: string) {
  const approver = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
  const window = approver ? await db.query(
    "SELECT 1 FROM whatsapp_events WHERE wa_id=$1 AND received_at > now()-interval '24 hours' LIMIT 1",
    [approver],
  ) : { rows: [] };
  if (window.rows.length) return (await sendDailyApproval(jobId)) ? "approval_sent" as const : "approval_not_sent" as const;
  if (!approver || !dailyNotificationTemplateConfigured()) return "template_required" as const;
  const attempted = await db.query(
    `UPDATE daily_drafts SET notification_send_attempted_at=now() WHERE job_id=$1
     AND status='awaiting_approval' AND whatsapp_message_id IS NULL
     AND notification_message_id IS NULL AND notification_send_attempted_at IS NULL RETURNING day`, [jobId],
  );
  if (!attempted.rows.length) return "notification_sent" as const;
  try {
    const messageId = await sendDailyNotificationTemplate();
    await db.query("UPDATE daily_drafts SET notification_message_id=$2,updated_at=now() WHERE job_id=$1", [jobId, messageId]);
    return "notification_sent" as const;
  } catch (error) {
    // A definite Meta rejection (e.g. unknown template/language) delivered nothing:
    // release the claim so the next cron call retries, and log only safe fields.
    if (error instanceof WhatsAppRejectedError) {
      await db.query("UPDATE daily_drafts SET notification_send_attempted_at=NULL,updated_at=now() WHERE job_id=$1 AND notification_message_id IS NULL", [jobId]);
      console.error(JSON.stringify({ event: "daily_template_rejected", jobId, httpStatus: error.httpStatus, code: error.code, subcode: error.subcode, detail: error.providerMessage }));
      return "template_rejected" as const;
    }
    throw error;
  }
}

// Scheduled slots are fully automatic: nobody can supply input, so a failed,
// needs_input or killed (stale claim) attempt is retried by the next cron call.
const MAX_SLOT_ATTEMPTS = 3;
const STALE_CLAIM_MINUTES = 7; // above the route's 300 s maxDuration

async function reclaimScheduledSlot(db: Database, day: string, slot: string, jobId: string) {
  const previous = await db.query("SELECT job_id FROM daily_drafts WHERE day=$1 AND slot=$2", [day, slot]);
  const oldJobId = previous.rows[0]?.job_id ? String(previous.rows[0].job_id) : null;
  const claimed = await db.query(
    `UPDATE daily_drafts SET job_id=$3,status='claimed',attempts=attempts+1,scout_report=NULL,
       whatsapp_message_id=NULL,whatsapp_send_attempted_at=NULL,
       notification_message_id=NULL,notification_send_attempted_at=NULL,updated_at=now()
     WHERE day=$1 AND slot=$2 AND attempts<$4 AND whatsapp_message_id IS NULL
       AND notification_message_id IS NULL
       AND (status IN ('failed','needs_input')
         OR (status IN ('claimed','planning') AND updated_at<now()-make_interval(mins=>$5)))
     RETURNING job_id`, [day, slot, jobId, MAX_SLOT_ATTEMPTS, STALE_CLAIM_MINUTES]);
  if (!claimed.rows.length) return false;
  if (oldJobId) {
    await releaseProduct(db, oldJobId);
    // A killed attempt leaves a non-terminal job that would block its product for seven days.
    await db.query("UPDATE content_jobs SET status='failed',updated_at=now() WHERE id=$1 AND status IN ('queued','checking','ideating','selecting','producing','reviewing','revising','marketing')", [oldJobId]);
  }
  console.info(JSON.stringify({ event: "daily_slot_retry", day, slot, previousJobId: oldJobId, jobId }));
  return true;
}

// The operator may have opened the 24 h window after the draft was planned.
// Claiming inside sendDailyApproval keeps this idempotent across cron retries.
async function resendPendingApproval(db: Database, day: string, slot: string) {
  const pending = await db.query(
    `SELECT job_id FROM daily_drafts WHERE day=$1 AND slot=$2 AND status='awaiting_approval'
     AND whatsapp_message_id IS NULL AND whatsapp_send_attempted_at IS NULL
     AND notification_message_id IS NULL`, [day, slot]);
  if (!pending.rows.length) return {};
  try { return { whatsapp: await deliverDailyApproval(db, String(pending.rows[0].job_id)) }; }
  catch { console.error(JSON.stringify({ event: "daily_approval_resend_failed", day, slot })); return { whatsapp: "approval_send_failed" as const }; }
}

// Sends every saved but unsent approval once the operator has (re)opened the window.
export async function sendPendingDailyApprovals(db: Database = getDatabase()) {
  const pending = await db.query(
    `SELECT job_id FROM daily_drafts WHERE status='awaiting_approval' AND whatsapp_message_id IS NULL
     AND whatsapp_send_attempted_at IS NULL AND created_at>now()-interval '48 hours' ORDER BY created_at LIMIT 4`);
  let sent = 0;
  for (const row of pending.rows) {
    try { if (await sendDailyApproval(String(row.job_id))) sent++; }
    catch { console.error(JSON.stringify({ event: "daily_approval_flush_failed", jobId: String(row.job_id) })); }
  }
  return sent;
}

export function berlinDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// Each scheduled slot or explicit operator message has its own durable claim.
// A retry of that slot/message never buys a second search or sends another approval.
export async function createDailyDraft(day = berlinDay(), slot = "morning", productQuery?: string, productSearch?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Ungültiger Tag.");
  if (!/^(morning|afternoon|manual:[A-Za-z0-9._:-]{1,160})$/.test(slot)) throw new Error("Ungültiger Auslöser.");
  if(productSearch && (productQuery || productSearch.length>90 || !/^[\p{L}\p{N}][\p{L}\p{N}\s.,+&-]*$/u.test(productSearch)))throw Error("Ungültiger Suchbegriff.");
  const db = getDatabase();
  await ensureAutomationSchema(db);
  const jobId = crypto.randomUUID();
  const claim = await db.query(
    "INSERT INTO daily_drafts(day,slot,job_id,status) VALUES($1,$2,$3,'claimed') ON CONFLICT(day,slot) DO NOTHING RETURNING job_id",
    [day, slot, jobId],
  );
  if (!claim.rows.length) {
    if (slot.startsWith("manual:")) return { status: "already_claimed" as const };
    const retry = await reclaimScheduledSlot(db, day, slot, jobId);
    if (!retry) return { status: "already_claimed" as const, ...(await resendPendingApproval(db, day, slot)) };
  }

  let stage = "product_search";
  try {
    const report = productQuery ? null : await runProductScout(productSearch,`${day}:${slot}`);
    // Prefer seasonal ideas, then already researched evergreen candidates.
    // Neither category becomes affiliate content without exact product resolution.
    const openSearch = slot.startsWith("manual:") && !productQuery && !productSearch;
    const candidates = report?.candidates.filter(candidate => productSearch
      ? candidate.searchQuery.toLocaleLowerCase("de-DE")===productSearch.toLocaleLowerCase("de-DE")
      : openSearch || candidate.kind === "Saisontrend" || candidate.kind === "Dauerläufer") || [];
    const relevantCooldownBlocked = productSearch || openSearch ? report?.cooldownBlocked : report?.cooldownBlockedAutomatic;
    if (!productQuery && !candidates.length && relevantCooldownBlocked) {
      await db.query("UPDATE daily_drafts SET status='needs_input',scout_report=$2,updated_at=now() WHERE job_id=$1",
        [jobId,JSON.stringify({requestedSearch:productSearch,report,reason:"product_repeat_blocked"})]);
      return {status:'needs_input' as const,jobId,reason:'product_repeat_blocked' as const};
    }
    if (!productQuery && !productSearch && !candidates.length) throw new Error("Kein geeigneter Kandidat verfügbar.");
    const resolved = candidates.filter(candidate => candidate.resolvedProduct);
    if(!productQuery && !resolved.length){
      const resolutionReason = candidates.some(candidate => "resolutionError" in candidate && candidate.resolutionError === "amazon_verification_blocked")
        ? "amazon_verification_blocked" as const : relevantCooldownBlocked ? "product_repeat_blocked" as const : "product_unresolved" as const;
      await db.query("UPDATE daily_drafts SET status='needs_input',scout_report=$2,updated_at=now() WHERE job_id=$1",
        [jobId,JSON.stringify({requestedSearch:productSearch,report,reason:resolutionReason})]);
      return {status:'needs_input' as const,jobId,reason:resolutionReason,searchTerm:productSearch};
    }
    const pool = resolved.length ? resolved : candidates;
    const rotation = openSearch ? createHash("sha256").update(slot).digest().readUInt32BE(0)
      : new Date(`${day}T00:00:00Z`).getUTCDate() + (slot === "afternoon" ? 1 : 0);
    await db.query("UPDATE daily_drafts SET status='planning',scout_report=$2,updated_at=now() WHERE job_id=$1", [jobId, JSON.stringify(report ? {requestedSearch:productSearch,report}: { requestedProduct: productQuery })]);
    stage = "product_verification";
    let requestedProduct: Awaited<ReturnType<typeof resolveRequestedProduct>> | null = null;
    if (productQuery) {
      try { requestedProduct = await resolveRequestedProduct(productQuery); }
      catch (error) {
        const code = error instanceof Error ? error.message : "unknown";
        if (code !== PRODUCT_UNRESOLVED && code !== "amazon_verification_blocked" && code !== AMAZON_IDENTITY_MISSING) throw error;
        await db.query("UPDATE daily_drafts SET status='needs_input',scout_report=$2,updated_at=now() WHERE job_id=$1",
          [jobId,JSON.stringify({requestedProduct:productQuery,reason:code})]);
        console.info(JSON.stringify({event:"daily_product_verification",jobId,reason:code}));
        return {status:"needs_input" as const,jobId,reason:code};
      }
    }
    let candidate: typeof pool[number] | null = null;
    let selectedProduct = requestedProduct;
    const rotate = (items: typeof pool) => [...items.slice(rotation % (items.length || 1)), ...items.slice(0,rotation % (items.length || 1))];
    const ordered = productSearch ? resolved : openSearch ? rotate(pool)
      : [...rotate(pool.filter(item => item.kind === "Saisontrend")), ...rotate(pool.filter(item => item.kind === "Dauerläufer"))];
    for (const item of requestedProduct ? [] : ordered) {
      if (item.resolvedProduct && await reserveProduct(db,item.resolvedProduct,jobId)) {
        candidate=item; selectedProduct=item.resolvedProduct; break;
      }
    }
    if (requestedProduct && !await reserveProduct(db,requestedProduct,jobId) || !selectedProduct) {
      await db.query("UPDATE daily_drafts SET status='needs_input',scout_report=jsonb_set(coalesce(scout_report,'{}'::jsonb),'{reason}',to_jsonb($2::text)),updated_at=now() WHERE job_id=$1", [jobId,"product_repeat_blocked"]);
      return {status:'needs_input' as const,jobId,reason:'product_repeat_blocked' as const};
    }
    const opportunity: Opportunity = {
      product: selectedProduct,
      category: isPumpkinCarvingProduct(requestedProduct?.name || candidate?.resolvedProduct?.name || candidate?.name || "") || candidate?.category === "Wohnen" ? "home_living" : "household", useCaseKey: "seasonal-product-guide", targetPlatform: "facebook",
      useCase: isBathtubMat(selectedProduct.name) ? bathtubMatUseCase : candidate?.reelIdea?.trim() || `Das Produkt ${selectedProduct.name} im Alltag verwenden und die Eignung vor dem Kauf prüfen.`, trend: candidate?.whyNow || "", goal: "education", budget: "low", verifiedFacts: [],
    };
    stage = "content_planning";
    const repo = memoryRepository(db);
    const approver=(process.env.WHATSAPP_APPROVER_WA_ID||"").replace(/\D/g,"");
    const corrections=await loadApprovedEditorialCorrections(db,approver,opportunity);
    const mode=corrections.length && process.env.REPLICATE_API_TOKEN?.trim() ? "ai" as const : "reference" as const;
    await repo.claim(jobId, opportunity, mode);
    const job = await runContentJob(opportunity, { id: jobId, mode, allowedFormats: ["image"],
      loadCorrections:async()=>corrections, loadLearning: value => repo.learn(value), onUpdate: value => repo.save(value) });
    const missingCaption = job.content?.format === "image" && !job.content.caption.trim();
    // Do not seek an approval for a plan that the later Facebook gate rejects.
    const gateError = !missingCaption && job.status === "awaiting_approval" && job.content?.format === "image"
      ? facebookPagePublicationError({ ...job, status: "approved" }) : null;
    const publishablePlan = !missingCaption && job.status === "awaiting_approval" && job.content?.format === "image" && !gateError;
    const status = publishablePlan ? "awaiting_approval" : "needs_input";
    await db.query("UPDATE daily_drafts SET status=$2,updated_at=now() WHERE job_id=$1", [jobId, status]);
    if (status !== "awaiting_approval") await releaseProduct(db,jobId);
    if (status === "awaiting_approval") {
      stage = "whatsapp_send";
      // Meta accepts free-form texts only within the 24-hour service window.
      // An approved business-initiated template is a separate configuration step.
      return { status, jobId, whatsapp: await deliverDailyApproval(db, jobId) };
    }
    const reason = missingCaption ? "missing_caption" as const
      : gateError ? "publication_gate_failed" as const
      : job.error === EDITORIAL_RATE_LIMIT_ERROR ? "editorial_rate_limited" as const
      : job.error === EDITORIAL_MODEL_ERROR ? "editorial_model_failed" as const
      : job.error === "product_unresolved" ? "product_unresolved" as const
      : job.review && !job.review.passed ? "content_review_failed" as const : "planning_failed" as const;
    // Persist why the slot stopped; without it Status cannot explain an empty needs_input.
    const detail = reason === "publication_gate_failed" ? String(gateError).slice(0, 200)
      : reason === "content_review_failed" ? job.review?.issues[0]?.slice(0, 200) : undefined;
    await db.query("UPDATE daily_drafts SET scout_report=jsonb_set(coalesce(scout_report,'{}'::jsonb),'{reason}',to_jsonb($2::text)) || jsonb_build_object('detail',$3::text),updated_at=now() WHERE job_id=$1",
      [jobId, reason, detail ?? null]);
    console.info(JSON.stringify({ event: "daily_draft_needs_input", jobId, reason }));
    return { status, jobId, reason, reviewIssues: reason === "content_review_failed"
      ? job.review?.issues.slice(0, 3).map(issue => issue.slice(0, 180)) : undefined };
  } catch (error) {
    // Preserve the one-time claim. Ambiguous network outcomes must not retry.
    console.error(JSON.stringify({event:"daily_draft_failed",jobId,stage,
      errorType:error instanceof Error?error.name:"unknown"}));
    // A complete, validated plan must survive a failed WhatsApp send. Marking it
    // failed would let a retry plan a second draft next to a possibly delivered one.
    if (stage === "whatsapp_send") return { status: "awaiting_approval" as const, jobId, whatsapp: "approval_send_failed" as const };
    await db.query("UPDATE daily_drafts SET status='failed',updated_at=now() WHERE job_id=$1", [jobId]);
    await releaseProduct(db,jobId);
    return { status: "failed" as const, jobId, reason: "internal_error" as const };
  }
}
