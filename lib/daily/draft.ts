import { runContentJob, runProductScout } from "@/lib/orchestrator";
import { getDatabase } from "@/lib/memory/db";
import { memoryRepository } from "@/lib/memory/repository";
import type { Opportunity } from "@/lib/content/schema";
import { sendWhatsAppText } from "@/lib/whatsapp/client";

// Cron runs in Production only. The date claim happens before any external search
// so a retried invocation cannot buy another search or send another message.
export async function createDailyDraft(day = new Date().toISOString().slice(0, 10)) {
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
    // The scout offers search categories, not verified individual products.
    // Pick one seasonal candidate; all model-specific properties remain open.
    const candidates = report.candidates.filter(candidate => candidate.kind === "Saisontrend");
    if (!candidates.length) throw new Error("Kein saisonaler Kandidat verfügbar.");
    const candidate = candidates[new Date(`${day}T00:00:00Z`).getUTCDate() % candidates.length];
    await db.query("UPDATE daily_drafts SET status='planning',scout_report=$2,updated_at=now() WHERE day=$1", [day, JSON.stringify(report)]);
    const opportunity: Opportunity = {
      product: { name: candidate.name, sourceUrl: candidate.amazonUrl, affiliateUrl: candidate.affiliateUrl,
        price: "", targetGroup: candidate.targetGroup,
        benefits: "Produktidee für einen Alltagseinsatz; Eignung und Eigenschaften am konkreten Modell prüfen.",
        notes: `Suchauswahl statt konkretem Produkt. Noch zu prüfen: ${candidate.benefitsToVerify.join(", ")}.` },
      category: "household", useCaseKey: "seasonal-product-guide", targetPlatform: "facebook",
      useCase: candidate.reelIdea, trend: candidate.whyNow, goal: "education", budget: "low", verifiedFacts: [],
    };
    const repo = memoryRepository(db);
    await repo.claim(jobId, opportunity, "reference");
    const job = await runContentJob(opportunity, { id: jobId, mode: "reference",
      loadLearning: value => repo.learn(value), onUpdate: value => repo.save(value) });
    const status = job.status === "awaiting_approval" ? "awaiting_approval" : "needs_input";
    await db.query("UPDATE daily_drafts SET status=$2,updated_at=now() WHERE day=$1", [day, status]);
    if (status === "awaiting_approval") {
      const approver = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
      // Meta accepts free-form texts only within the 24-hour service window.
      // An approved business-initiated template is a separate configuration step.
      const window = approver ? await db.query(
        "SELECT 1 FROM whatsapp_events WHERE wa_id=$1 AND received_at > now()-interval '24 hours' LIMIT 1",
        [approver],
      ) : { rows: [] };
      if (!window.rows.length) return { status, jobId, whatsapp: "template_required" as const };
      const attempted = await db.query(
        "UPDATE daily_drafts SET whatsapp_send_attempted_at=now() WHERE day=$1 AND whatsapp_send_attempted_at IS NULL RETURNING day",
        [day],
      );
      if (attempted.rows.length) {
        const summary = job.content?.format === "text" ? job.content.body : job.content?.format === "image" ? job.content.caption : "Videoentwurf";
        const messageId = await sendWhatsAppText(`Tagesentwurf ${day}: ${candidate.name}\nFormat: ${job.content?.format || "unbekannt"} · Ziel: Facebook\n\n${(summary || "").slice(0, 600)}\n\nSuchauswahl, kein geprüftes Einzelprodukt. Öffne das Content Studio und prüfe Job ${jobId}. Es ist noch nichts veröffentlicht. Eine gesonderte WhatsApp-Freigabe für die Veröffentlichung ist erforderlich.`);
        await db.query("UPDATE daily_drafts SET whatsapp_message_id=$2,updated_at=now() WHERE day=$1", [day, messageId]);
      }
    }
    return { status, jobId };
  } catch {
    // Preserve the one-time claim. Ambiguous network outcomes must not retry.
    await db.query("UPDATE daily_drafts SET status='failed',updated_at=now() WHERE day=$1", [day]);
    return { status: "failed" as const, jobId };
  }
}
