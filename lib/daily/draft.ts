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
import { AMAZON_IDENTITY_MISSING, findAmazonProductByAsin } from "@/lib/product-resolver";
import { ensureAutomationSchema } from "@/lib/memory/ensure-automation-schema";
import { loadApprovedEditorialCorrections } from "@/lib/whatsapp/language-memory";
import { EDITORIAL_MODEL_ERROR, EDITORIAL_RATE_LIMIT_ERROR } from "@/lib/content/model";
import { createHash } from "node:crypto";
import { releaseProduct, reserveMandatedProduct, reserveProduct } from "@/lib/daily/product-lock";
import { facebookCaption } from "@/lib/meta/facebook-caption";
import { bathtubMatUseCase, isBathtubMat } from "@/lib/content/bathtub-mat";
import { STRATEGY_REJECTED, type AgentProvenance, type ChanceAssessment, type ContentChance } from "@/lib/content/strategy";
import { PRODUCT_DATA_UNCERTAIN, productEvidence, unsupportedClaims } from "@/lib/content/claim-support";
import { suggestCategory } from "@/lib/content/taxonomy";
import { categoryLabel } from "@/lib/content/category-store";

async function resolveRequestedProduct(value: string) {
  const asin = /^(?:[A-Z0-9]{10})$/.test(value) ? value : value.match(/^https:\/\/(?:www\.)?amazon\.de\/dp\/([A-Z0-9]{10})\/?$/)?.[1];
  if (!asin) throw new Error("Produkt nur als ASIN oder sauberen Amazon.de/dp/-Link angeben.");
  return findAmazonProductByAsin(asin);
}

import { labelFor as labelOf } from "@/lib/content/taxonomy";
export function dailyApprovalMessage(job:ReturnType<typeof parseJob>,day:string,categoryName?:string) {
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
  const body=`Content-Freigabe · Bildpost ${day}\nProdukt: ${job.opportunity.product.name}\nKategorie: ${categoryName||labelOf(job.opportunity.category)} (so wird der Beitrag auf der Landingpage einsortiert)\nTitel: ${job.content.title}\nFormat: ${job.content?.format || 'unbekannt'} · Facebook\n\n${referenceNotice}Beitragstext (geplante Facebook-Caption):\n${publicCaption}${visualBrief}\n\nASIN: ${job.opportunity.product.asin}\nProduktlink: ${job.opportunity.product.affiliateUrl}\nAntworte auf DIESE Nachricht mit „Freigeben“, ${costText}. Danach kommt eine ZWEITE WhatsApp für die Veröffentlichung. „Ablehnen“ stoppt den Auftrag, Änderungswünsche bitte als Text (auch die Kategorie, z. B. „Kategorie bitte Küche“). Noch kein Post ist online.`;
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
  const body=dailyApprovalMessage(job,new Date(String(record.rows[0].day)).toISOString().slice(0,10),await categoryLabel(db,job.opportunity.category));
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
       AND COALESCE(scout_report->>'reason','') NOT IN ('no_quality_candidate','strategic_gate_rejected')
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

// One structured line per slot step; fields are ids, states and clipped error text only.
function slotLog(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ event, ...fields }));
}
function safeReason(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/https?:\/\/\S+/g, "<url>").replace(/[A-Za-z0-9_-]{32,}/g, "<redacted>").slice(0, 160);
}

// Each scheduled slot or explicit operator message has its own durable claim.
// A retry of that slot/message never buys a second search or sends another approval.
// options.mandate: explicit operator order for a named product (ASIN, link or product search) on a manual slot. It overrides
// the TrendScout cooldown, never the duplicate protection, content review, content approval or publication approval.
export type DraftOptions = { mandate?: boolean };
async function planDailyDraft(day: string, slot: string, productQuery?: string, productSearch?: string, options: DraftOptions = {}) {
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
    const existing = await db.query(
      "SELECT job_id,status,attempts,whatsapp_message_id IS NOT NULL AS delivered,notification_message_id IS NOT NULL AS notified,updated_at FROM daily_drafts WHERE day=$1 AND slot=$2", [day, slot]);
    const row = existing.rows[0];
    const slotState = !row ? "unknown" : row.delivered || row.notified ? "done"
      : ["claimed", "planning"].includes(String(row.status)) ? "in_progress" : "open";
    const retry = await reclaimScheduledSlot(db, day, slot, jobId);
    slotLog("daily_slot_claim", { day, slot, claim: retry ? "reclaimed" : "rejected", slotState,
      status: row?.status, attempts: row?.attempts, jobId: String(row?.job_id ?? ""), attemptJobId: retry ? jobId : undefined });
    if (!retry) {
      if (slotState === "open" && Number(row?.attempts) >= MAX_SLOT_ATTEMPTS && ["failed", "needs_input"].includes(String(row?.status)))
        console.error(JSON.stringify({ event: "daily_slot_exhausted", day, slot, status: row.status, attempts: row.attempts, jobId: String(row.job_id) }));
      return { status: "already_claimed" as const, ...(await resendPendingApproval(db, day, slot)) };
    }
  } else slotLog("daily_slot_claim", { day, slot, claim: "accepted", jobId });

  let stage = "product_search";
  try {
    // Only scheduled slots are held to the content-chance quality gate; operator requests never are.
    const scheduled = slot === "morning" || slot === "afternoon";
    const mandate = !!options.mandate && slot.startsWith("manual:") && !!(productQuery || productSearch);
    const report = productQuery ? null : await runProductScout(productSearch,`${day}:${slot}`,{ quality: scheduled, ...(mandate ? { mandate: true } : {}) });
    // Prefer seasonal ideas, then already researched evergreen candidates.
    // Neither category becomes affiliate content without exact product resolution.
    const openSearch = slot.startsWith("manual:") && !productQuery && !productSearch;
    const candidates = report?.candidates.filter(candidate => productSearch
      ? candidate.searchQuery.toLocaleLowerCase("de-DE")===productSearch.toLocaleLowerCase("de-DE")
      : openSearch || candidate.kind === "Saisontrend" || candidate.kind === "Dauerläufer") || [];
    const relevantCooldownBlocked = productSearch || openSearch ? report?.cooldownBlocked : report?.cooldownBlockedAutomatic;
    // No candidate with a real content chance: no proposal is better than a pointless one. Terminal for this slot.
    if (!productQuery && !candidates.length && !relevantCooldownBlocked && scheduled && report && "qualityBlocked" in report && Number(report.qualityBlocked) > 0) {
      await db.query("UPDATE daily_drafts SET status='needs_input',scout_report=$2,updated_at=now() WHERE job_id=$1",
        [jobId,JSON.stringify({report:{qualityRejected:"qualityRejected" in report?report.qualityRejected:[]},reason:"no_quality_candidate"})]);
      await releaseProduct(db,jobId);
      slotLog("daily_slot_no_quality_candidate", { day, slot, jobId, rejected: report.qualityBlocked });
      return {status:'needs_input' as const,jobId,reason:'no_quality_candidate' as const};
    }
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
    await db.query("UPDATE daily_drafts SET status='planning',scout_report=$2,updated_at=now() WHERE job_id=$1", [jobId, JSON.stringify({ ...(report ? {requestedSearch:productSearch,report}: { requestedProduct: productQuery }), ...(mandate ? { operatorMandate: true } : {}) })]);
    slotLog("daily_slot_stage", { day, slot, jobId, stage: "product_found", candidates: candidates.length });
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
    const assessmentOf = (item: typeof pool[number]) => (item as { assessment?: ChanceAssessment }).assessment;
    const priorityOf = (item: typeof pool[number]) => (item as { priority?: number }).priority ?? 99; // the trend agent's own ranking comes first
    const ordered = productSearch ? resolved : openSearch ? rotate(pool)
      : scheduled && pool.every(item => assessmentOf(item)) ? [...pool].sort((a, b) => (priorityOf(a) - priorityOf(b)) || assessmentOf(b)!.score - assessmentOf(a)!.score)
      : [...rotate(pool.filter(item => item.kind === "Saisontrend")), ...rotate(pool.filter(item => item.kind === "Dauerläufer"))];
    // Automatic selection: full cooldown. Operator mandate: cooldown overridden, an already running draft/publication of
    // the exact product still blocks a second one.
    let alreadyOpen = false;
    const reserve = async (product: NonNullable<typeof selectedProduct>) => {
      if (!mandate) return reserveProduct(db, product, jobId);
      const outcome = await reserveMandatedProduct(db, product, jobId);
      if (outcome === "already_open") alreadyOpen = true;
      return outcome === "reserved";
    };
    for (const item of requestedProduct ? [] : ordered) {
      if (item.resolvedProduct && await reserve(item.resolvedProduct)) {
        candidate=item; selectedProduct=item.resolvedProduct; break;
      }
    }
    if (requestedProduct && !await reserve(requestedProduct) || !selectedProduct) {
      const blockReason = alreadyOpen ? "product_already_open" as const : "product_repeat_blocked" as const;
      await db.query("UPDATE daily_drafts SET status='needs_input',scout_report=jsonb_set(coalesce(scout_report,'{}'::jsonb),'{reason}',to_jsonb($2::text)),updated_at=now() WHERE job_id=$1", [jobId,blockReason]);
      return {status:'needs_input' as const,jobId,reason:blockReason};
    }
    // The scout's idea is category-level. It may only steer the content if THIS article's data supports it.
    const rawUseCase = candidate?.reelIdea?.trim();
    const useCaseGaps = rawUseCase ? unsupportedClaims(rawUseCase, productEvidence(selectedProduct)) : [];
    if (useCaseGaps.length) console.info(JSON.stringify({ event: "use_case_neutralized", jobId, claims: useCaseGaps.map(claim => claim.id) }));
    const scoutUseCase = useCaseGaps.length ? "" : rawUseCase;
    const opportunity: Opportunity = {
      product: selectedProduct,
      category: suggestCategory(selectedProduct.name, candidate?.category, candidate?.kind), useCaseKey: "seasonal-product-guide", targetPlatform: "facebook",
      ...(candidate && assessmentOf(candidate) ? { contentChance: { chance: (candidate as { chance?: ContentChance }).chance ?? null, assessment: assessmentOf(candidate)!,
        ...((candidate as { agent?: AgentProvenance }).agent ? { agent: (candidate as { agent?: AgentProvenance }).agent } : {}) } } : {}),
      useCase: isBathtubMat(selectedProduct.name) ? bathtubMatUseCase : scoutUseCase || `Das Produkt ${selectedProduct.name} im Alltag verwenden und die Eignung vor dem Kauf prüfen.`, trend: candidate?.whyNow || "", goal: "education", budget: "low", verifiedFacts: [],
    };
    stage = "content_planning";
    slotLog("daily_slot_stage", { day, slot, jobId, stage });
    const repo = memoryRepository(db);
    const approver=(process.env.WHATSAPP_APPROVER_WA_ID||"").replace(/\D/g,"");
    const corrections=await loadApprovedEditorialCorrections(db,approver,opportunity);
    // The model-written draft is tried once per slot. If it failed (provider outage, off-schema answer), the retry uses the
    // deterministic reference draft instead of repeating the same failure until the attempts are used up.
    const attempt = Number((await db.query("SELECT attempts FROM daily_drafts WHERE job_id=$1", [jobId])).rows[0]?.attempts ?? 1);
    const mode=corrections.length && process.env.REPLICATE_API_TOKEN?.trim() && (attempt<2 || !scheduled) ? "ai" as const : "reference" as const;
    if (attempt >= 2 && scheduled && corrections.length) slotLog("daily_slot_stage", { day, slot, jobId, stage: "reference_mode_after_failed_attempt" });
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
      slotLog("daily_slot_stage", { day, slot, jobId, stage: "draft_saved" });
      stage = "whatsapp_send";
      slotLog("daily_slot_stage", { day, slot, jobId, stage });
      // Meta accepts free-form texts only within the 24-hour service window.
      // An approved business-initiated template is a separate configuration step.
      const whatsapp = await deliverDailyApproval(db, jobId);
      slotLog("daily_slot_whatsapp", { day, slot, jobId, whatsapp, slotCompleted: whatsapp === "approval_sent" || whatsapp === "notification_sent" });
      return { status, jobId, whatsapp };
    }
    const reason = missingCaption ? "missing_caption" as const
      : gateError ? "publication_gate_failed" as const
      : job.error === EDITORIAL_RATE_LIMIT_ERROR ? "editorial_rate_limited" as const
      : job.error === EDITORIAL_MODEL_ERROR ? "editorial_model_failed" as const
      : job.error === "product_unresolved" ? "product_unresolved" as const
      : job.error === PRODUCT_DATA_UNCERTAIN ? "product_data_uncertain" as const
      : job.error === STRATEGY_REJECTED ? "strategic_gate_rejected" as const
      : job.review && !job.review.passed ? "content_review_failed" as const
      : job.status === "needs_input" && job.marketing ? "marketing_format_mismatch" as const : "planning_failed" as const;
    // Persist why the slot stopped; without it Status cannot explain an empty needs_input.
    const detail = reason === "publication_gate_failed" ? String(gateError).slice(0, 200)
      : reason === "content_review_failed" || reason === "product_data_uncertain" || reason === "strategic_gate_rejected" ? job.review?.issues[0]?.slice(0, 200) : undefined;
    await db.query("UPDATE daily_drafts SET scout_report=jsonb_set(coalesce(scout_report,'{}'::jsonb),'{reason}',to_jsonb($2::text)) || jsonb_build_object('detail',$3::text),updated_at=now() WHERE job_id=$1",
      [jobId, reason, detail ?? null]);
    console.info(JSON.stringify({ event: "daily_draft_needs_input", jobId, reason }));
    return { status, jobId, reason, reviewIssues: reason === "content_review_failed"
      ? job.review?.issues.slice(0, 3).map(issue => issue.slice(0, 180)) : undefined };
  } catch (error) {
    // Preserve the one-time claim. Ambiguous network outcomes must not retry.
    console.error(JSON.stringify({event:"daily_draft_failed",day,slot,jobId,stage,reason:safeReason(error),
      errorType:error instanceof Error?error.name:"unknown"}));
    // A complete, validated plan must survive a failed WhatsApp send. Marking it
    // failed would let a retry plan a second draft next to a possibly delivered one.
    if (stage === "whatsapp_send") return { status: "awaiting_approval" as const, jobId, whatsapp: "approval_send_failed" as const };
    await db.query("UPDATE daily_drafts SET status='failed',updated_at=now() WHERE job_id=$1", [jobId]);
    await releaseProduct(db,jobId);
    return { status: "failed" as const, jobId, reason: "internal_error" as const };
  }
}


// ---- Operator notice: a scheduled slot that ends without a proposal never dies silently ----------------------
const TERMINAL_REASONS = new Set(["no_quality_candidate", "strategic_gate_rejected"]);
function slotNoticeText(slot: string, result: { status: string; reason?: string }) {
  const name = slot === "morning" ? "Vormittag" : "Nachmittag";
  const why = ({
    no_quality_candidate: "Kein Kandidat hatte genug Content-Potenzial. Bewusst kein Vorschlag statt eines schwachen Beitrags.",
    strategic_gate_rejected: "Der Kandidat hat die strategische Prüfung (Reichweite/Vertrauen) nicht bestanden.",
    product_unresolved: "Ich konnte keine sicher verifizierte Amazon-Produktseite finden.",
    amazon_verification_blocked: "Amazon hat die automatische Produktprüfung blockiert.",
    amazon_identity_missing: "Die Amazon-Seite enthielt keinen eindeutigen ASIN-Nachweis.",
    product_repeat_blocked: "Alle passenden Produkte wurden in den letzten 7 Tagen verwendet oder abgelehnt.",
    product_data_uncertain: "Die Produktdaten belegen die geplanten Aussagen nicht.",
    editorial_rate_limited: "Das Redaktionsmodell war ausgelastet.",
    editorial_model_failed: "Das Redaktionsmodell hat keinen prüfbaren Entwurf geliefert.",
    publication_gate_failed: "Der Entwurf war nicht freigabefähig.",
    content_review_failed: "Der Entwurf hat die redaktionelle Prüfung nicht bestanden.",
    missing_caption: "Der Beitragstext fehlte.",
  } as Record<string, string>)[result.reason || ""] || (result.status === "failed" ? "Es gab einen technischen Fehler." : "Die Planung konnte nicht abgeschlossen werden.");
  const retry = !TERMINAL_REASONS.has(result.reason || "") ? " Ich versuche es beim nächsten Lauf noch einmal." : "";
  return `Für den ${name}-Slot gibt es gerade keinen Vorschlag: ${why} Es wurde nichts erzeugt oder veröffentlicht.${retry} Mit „Artikelsuche <Produkt>“ startest du selbst einen Vorschlag, „Status“ zeigt Details.`;
}

// At most one notice per slot (marker in daily_drafts.feedback, which a retry does not reset); only inside the 24 h window.
async function notifySlotOutcome(day: string, slot: string, result: { status: string; reason?: string }) {
  try {
    const db = getDatabase();
    const approver = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
    const open = approver ? await db.query("SELECT 1 FROM whatsapp_events WHERE wa_id=$1 AND received_at>now()-interval '24 hours' LIMIT 1", [approver]) : { rows: [] };
    if (!open.rows.length) { slotLog("daily_slot_notice", { day, slot, notice: "window_closed", reason: result.reason }); return; }
    // A first, possibly transient failure is retried by the next cron call; the operator hears about it from the second failed attempt on.
    const state = await db.query("SELECT attempts FROM daily_drafts WHERE day=$1 AND slot=$2", [day, slot]);
    if (!TERMINAL_REASONS.has(result.reason || "") && Number(state.rows[0]?.attempts ?? 1) < 2) { slotLog("daily_slot_notice", { day, slot, notice: "deferred_retry_pending", reason: result.reason }); return; }
    const claimed = await db.query("UPDATE daily_drafts SET feedback='slot_notice_sent' WHERE day=$1 AND slot=$2 AND feedback='' RETURNING job_id", [day, slot]);
    if (!claimed.rows.length) return;
    try { await sendWhatsAppText(slotNoticeText(slot, result)); slotLog("daily_slot_notice", { day, slot, notice: "sent", reason: result.reason }); }
    catch { await db.query("UPDATE daily_drafts SET feedback='' WHERE day=$1 AND slot=$2 AND feedback='slot_notice_sent'", [day, slot]); throw new Error("send_failed"); }
  } catch { console.error(JSON.stringify({ event: "daily_slot_notice_failed", day, slot })); }
}

export async function createDailyDraft(day = berlinDay(), slot = "morning", productQuery?: string, productSearch?: string, options: DraftOptions = {}) {
  const result = await planDailyDraft(day, slot, productQuery, productSearch, options);
  if ((slot === "morning" || slot === "afternoon") && (result.status === "needs_input" || result.status === "failed") && "jobId" in result)
    await notifySlotOutcome(day, slot, { status: result.status, reason: "reason" in result ? String(result.reason) : undefined });
  return result;
}
