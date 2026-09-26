import { requireProduct } from "@/lib/amazon";
import { imageProviderStatus } from "@/lib/content/image-provider";
import { runContentJob, runProductScout } from "@/lib/orchestrator";
import { getDatabase } from "@/lib/memory/db";
import { memoryRepository } from "@/lib/memory/repository";
import type { Opportunity } from "@/lib/content/schema";
import { sendWhatsAppText } from "@/lib/whatsapp/client";
import { dailyNotificationTemplateConfigured, sendDailyNotificationTemplate } from "@/lib/whatsapp/client";
import { parseJob } from "@/lib/content/history";
import { facebookPagePublicationError } from "@/lib/meta/publication-eligibility";

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
  const claimed = await db.query(
    `UPDATE daily_drafts SET whatsapp_send_attempted_at=now() WHERE job_id=$1
     AND status='awaiting_approval' AND whatsapp_message_id IS NULL
     AND whatsapp_send_attempted_at IS NULL RETURNING day`, [jobId],
  );
  if (!claimed.rows.length) return false;
  const revision=job.events.map(e=>e.data).reverse().find((data): data is {kind:string;instruction:{requires_new_generation:boolean}} => !!data && typeof data==='object' && 'kind' in data && data.kind==='semantic_revision');
  const costText=revision && !revision.instruction.requires_new_generation
    ? 'um die Textrevision freizugeben. Das bestehende Bild bleibt erhalten; keine neue Bildgenerierung'
    : `um den Content-Plan und eine einmalige kostenpflichtige Bildgenerierung freizugeben (Bildprovider: ${imageProviderStatus().provider || "nicht eingerichtet"}, EUR-Kosten nicht vorab bestätigt)`;
  const summary = job.content?.format === "text" ? job.content.body : job.content?.format === "image" ? job.content.caption : "Videoentwurf";
  const visualBrief = job.content?.format === "image" ? `\n\nBildbriefing: ${job.content.slides.map(slide=>slide.visual).join(" ").slice(0,600)}` : "";
  const messageId = await sendWhatsAppText(`Content-Freigabe · Tagesentwurf ${new Date(String(claimed.rows[0].day)).toISOString().slice(0, 10)}\nProdukt: ${job.opportunity.product.name}\nFormat: ${job.content?.format || "unbekannt"} · Facebook\n\n${(summary || "").slice(0, 1100)}${visualBrief}\n\nASIN: ${job.opportunity.product.asin}\nProduktlink: ${job.opportunity.product.affiliateUrl}\n Antworte auf DIESE Nachricht mit „Freigeben“, ${costText}. Danach kommt eine ZWEITE WhatsApp für die Veröffentlichung. „Ablehnen“ stoppt den Auftrag, Änderungswünsche bitte als Text. Noch kein Post ist online.`);
  await db.query("UPDATE daily_drafts SET whatsapp_message_id=$2,updated_at=now() WHERE job_id=$1 AND status='awaiting_approval'", [jobId, messageId]);
  return true;
}

// Cron runs in Production only. The date claim happens before any external search
// so a retried invocation cannot buy another search or send another message.
export async function createDailyDraft(day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Ungültiger Tag.");
  const db = getDatabase();
  const jobId = crypto.randomUUID();
  const claim = await db.query(
    "INSERT INTO daily_drafts(day,job_id,status) VALUES($1,$2,'claimed') ON CONFLICT(day) DO NOTHING RETURNING job_id",
    [day, jobId],
  );
  if (!claim.rows.length) return { status: "already_claimed" as const };

  try {
    const report = await runProductScout();
    // A seasonal idea becomes affiliate content only after exact product resolution.
    const candidates = report.candidates.filter(candidate => candidate.kind === "Saisontrend");
    if (!candidates.length) throw new Error("Kein saisonaler Kandidat verfügbar.");
    const resolved = candidates.filter(candidate => candidate.resolvedProduct);
    const pool = resolved.length ? resolved : candidates;
    const candidate = pool[new Date(`${day}T00:00:00Z`).getUTCDate() % pool.length];
    await db.query("UPDATE daily_drafts SET status='planning',scout_report=$2,updated_at=now() WHERE day=$1", [day, JSON.stringify(report)]);
    const opportunity: Opportunity = {
      product: candidate.resolvedProduct || { name: candidate.name, sourceUrl: "https://www.amazon.de/", affiliateUrl: "",
        price: "", targetGroup: candidate.targetGroup, benefits: "Konkretes Produkt noch nicht aufgelöst.", notes: "product_unresolved" },
      category: candidate.category === "Wohnen" ? "home_living" : "household", useCaseKey: "seasonal-product-guide", targetPlatform: "facebook",
      useCase: candidate.reelIdea, trend: candidate.whyNow, goal: "education", budget: "low", verifiedFacts: [],
    };
    const repo = memoryRepository(db);
    await repo.claim(jobId, opportunity, "reference");
    const job = await runContentJob(opportunity, { id: jobId, mode: "reference", allowedFormats: ["image"],
      loadLearning: value => repo.learn(value), onUpdate: value => repo.save(value) });
    // Do not seek an approval for a plan that the later Facebook gate rejects.
    const publishablePlan = job.status === "awaiting_approval" && job.content?.format === "image"
      && !facebookPagePublicationError({ ...job, status: "approved" });
    const status = publishablePlan ? "awaiting_approval" : "needs_input";
    await db.query("UPDATE daily_drafts SET status=$2,updated_at=now() WHERE day=$1", [day, status]);
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
          `UPDATE daily_drafts SET notification_send_attempted_at=now() WHERE day=$1
           AND notification_send_attempted_at IS NULL RETURNING day`, [day],
        );
        if (attempted.rows.length) {
          const messageId = await sendDailyNotificationTemplate();
          await db.query("UPDATE daily_drafts SET notification_message_id=$2,updated_at=now() WHERE day=$1", [day, messageId]);
        }
        return { status, jobId, whatsapp: "notification_sent" as const };
      }
    }
    return { status, jobId, ...(job.error ? { error: job.error } : {}) };
  } catch {
    // Preserve the one-time claim. Ambiguous network outcomes must not retry.
    await db.query("UPDATE daily_drafts SET status='failed',updated_at=now() WHERE day=$1", [day]);
    return { status: "failed" as const, jobId };
  }
}
