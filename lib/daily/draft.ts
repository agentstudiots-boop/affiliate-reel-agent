import { requireProduct } from "@/lib/amazon";
import { imageProviderStatus } from "@/lib/content/image-provider";
import { runContentJob, runProductScout } from "@/lib/orchestrator";
import { getDatabase } from "@/lib/memory/db";
import { memoryRepository } from "@/lib/memory/repository";
import type { Opportunity } from "@/lib/content/schema";
import { sendWhatsAppText, WhatsAppRejectedError } from "@/lib/whatsapp/client";
import { dailyNotificationTemplateConfigured, sendDailyNotificationTemplate } from "@/lib/whatsapp/client";
import { parseJob } from "@/lib/content/history";
import { facebookPagePublicationError } from "@/lib/meta/publication-eligibility";
import { imageBrief } from "@/lib/content/image-brief";
import { isPumpkinCarvingProduct } from "@/lib/content/category";
import { findAmazonProductByAsin } from "@/lib/product-resolver";
import { ensureAutomationSchema } from "@/lib/memory/ensure-automation-schema";
import { loadApprovedEditorialCorrections } from "@/lib/whatsapp/language-memory";
import { EDITORIAL_MODEL_ERROR, EDITORIAL_RATE_LIMIT_ERROR } from "@/lib/content/model";
import { createHash } from "node:crypto";
import { releaseProduct, reserveProduct } from "@/lib/daily/product-lock";
import { facebookCaption } from "@/lib/meta/facebook-caption";

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
  if (!claim.rows.length) return { status: "already_claimed" as const };

  let stage = "product_search";
  try {
    const report = productQuery ? null : await runProductScout(productSearch);
    // A seasonal idea becomes affiliate content only after exact product resolution.
    const openSearch = slot.startsWith("manual:") && !productQuery && !productSearch;
    const candidates = report?.candidates.filter(candidate => productSearch
      ? candidate.searchQuery.toLocaleLowerCase("de-DE")===productSearch.toLocaleLowerCase("de-DE")
      : openSearch || candidate.kind === "Saisontrend") || [];
    if (!productQuery && !productSearch && !candidates.length) throw new Error("Kein saisonaler Kandidat verfügbar.");
    const resolved = candidates.filter(candidate => candidate.resolvedProduct);
    if(!productQuery && !resolved.length){
      const resolutionReason = candidates.some(candidate => "resolutionError" in candidate && candidate.resolutionError === "amazon_verification_blocked")
        ? "amazon_verification_blocked" as const : "product_unresolved" as const;
      await db.query("UPDATE daily_drafts SET status='needs_input',scout_report=$2,updated_at=now() WHERE job_id=$1",
        [jobId,JSON.stringify({requestedSearch:productSearch,report,reason:resolutionReason})]);
      return {status:'needs_input' as const,jobId,reason:resolutionReason,searchTerm:productSearch};
    }
    const pool = resolved.length ? resolved : candidates;
    const rotation = openSearch ? createHash("sha256").update(slot).digest().readUInt32BE(0)
      : new Date(`${day}T00:00:00Z`).getUTCDate() + (slot === "afternoon" ? 1 : 0);
    await db.query("UPDATE daily_drafts SET status='planning',scout_report=$2,updated_at=now() WHERE job_id=$1", [jobId, JSON.stringify(report ? {requestedSearch:productSearch,report}: { requestedProduct: productQuery })]);
    stage = "product_verification";
    const requestedProduct = productQuery ? await resolveRequestedProduct(productQuery) : null;
    let candidate: typeof pool[number] | null = null;
    let selectedProduct = requestedProduct;
    const ordered = productSearch ? resolved : [...pool.slice(rotation % (pool.length || 1)), ...pool.slice(0,rotation % (pool.length || 1))];
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
      useCase: candidate?.reelIdea?.trim() || `Das Produkt ${selectedProduct.name} im Alltag verwenden und die Eignung vor dem Kauf prüfen.`, trend: candidate?.whyNow || "", goal: "education", budget: "low", verifiedFacts: [],
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
    const publishablePlan = !missingCaption && job.status === "awaiting_approval" && job.content?.format === "image"
      && !facebookPagePublicationError({ ...job, status: "approved" });
    const status = publishablePlan ? "awaiting_approval" : "needs_input";
    await db.query("UPDATE daily_drafts SET status=$2,updated_at=now() WHERE job_id=$1", [jobId, status]);
    if (status !== "awaiting_approval") await releaseProduct(db,jobId);
    if (status === "awaiting_approval") {
      const approver = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
      // Meta accepts free-form texts only within the 24-hour service window.
      // An approved business-initiated template is a separate configuration step.
      const window = approver ? await db.query(
        "SELECT 1 FROM whatsapp_events WHERE wa_id=$1 AND received_at > now()-interval '24 hours' LIMIT 1",
        [approver],
      ) : { rows: [] };
      if (window.rows.length) {
        const sent = await sendDailyApproval(jobId);
        return { status, jobId, whatsapp: sent ? "approval_sent" as const : "approval_not_sent" as const };
      }
      else {
        if (!approver || !dailyNotificationTemplateConfigured()) return { status, jobId, whatsapp: "template_required" as const };
        const attempted = await db.query(
          `UPDATE daily_drafts SET notification_send_attempted_at=now() WHERE job_id=$1
           AND notification_send_attempted_at IS NULL RETURNING day`, [jobId],
        );
        if (attempted.rows.length) {
          const messageId = await sendDailyNotificationTemplate();
          await db.query("UPDATE daily_drafts SET notification_message_id=$2,updated_at=now() WHERE job_id=$1", [jobId, messageId]);
        }
        return { status, jobId, whatsapp: "notification_sent" as const };
      }
    }
    const reason = missingCaption ? "missing_caption" as const
      : job.error === EDITORIAL_RATE_LIMIT_ERROR ? "editorial_rate_limited" as const
      : job.error === EDITORIAL_MODEL_ERROR ? "editorial_model_failed" as const
      : job.error === "product_unresolved" ? "product_unresolved" as const
      : job.review && !job.review.passed ? "content_review_failed" as const : "planning_failed" as const;
    return { status, jobId, reason, reviewIssues: reason === "content_review_failed"
      ? job.review?.issues.slice(0, 3).map(issue => issue.slice(0, 180)) : undefined };
  } catch (error) {
    // Preserve the one-time claim. Ambiguous network outcomes must not retry.
    console.error(JSON.stringify({event:"daily_draft_failed",jobId,stage,
      errorType:error instanceof Error?error.name:"unknown"}));
    await db.query("UPDATE daily_drafts SET status='failed',updated_at=now() WHERE job_id=$1", [jobId]);
    await releaseProduct(db,jobId);
    return { status: "failed" as const, jobId, reason: "internal_error" as const };
  }
}
