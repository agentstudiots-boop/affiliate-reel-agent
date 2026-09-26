import { requireJobProduct } from "../content/product-contract";
import { randomBytes } from "node:crypto";
import { parseJob } from "../content/history";
import { getDatabase, type Database } from "../memory/db";
import { chooseVideoProvider } from "./policy";
import { approvalRequestSchema, productionRunSchema, type ApprovalRequest, type ProductionRun } from "./schema";
import { classifyWhatsAppReply } from "../whatsapp/intent";
import { reviseApprovedVideo } from "../content/orchestrator";

export class ProductionConflictError extends Error {}

function asIso(value: unknown) {
  return new Date(String(value)).toISOString();
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

function mapRun(row: Record<string, unknown>): ProductionRun {
  return productionRunSchema.parse({
    id: row.id,
    jobId: row.job_id,
    contentType: row.content_type,
    provider: row.provider,
    providerMode: row.provider_mode,
    status: row.status,
    estimatedCostCents: nullableNumber(row.estimated_cost_cents),
    estimatedProviderCredits: nullableNumber(row.estimated_provider_credits),
    currency: row.currency,
    providerJobId: row.provider_job_id ?? null,
    outputUrl: row.output_url ?? null,
    revisionRequest: row.revision_request ?? "",
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  });
}

function mapApproval(row: Record<string, unknown>): ApprovalRequest {
  return approvalRequestSchema.parse({
    id: row.id,
    productionRunId: row.production_run_id,
    jobId: row.job_id,
    kind: row.kind,
    status: row.status,
    estimatedCostCents: nullableNumber(row.estimated_cost_cents),
    estimatedCommissionCents: nullableNumber(row.estimated_commission_cents),
    currency: row.currency,
    summary: row.summary,
    whatsappMessageId: row.whatsapp_message_id ?? null,
    approverWaId: row.approver_wa_id ?? null,
    feedback: row.feedback ?? "",
    createdAt: asIso(row.created_at),
    decidedAt: row.decided_at ? asIso(row.decided_at) : null,
  });
}

export function productionRepository(db: Database = getDatabase()) {
  return {
    async successfulVideoCount() {
      const result = await db.query("SELECT count(*) AS n FROM production_runs WHERE content_type='video' AND status='ready'");
      return Number(result.rows[0]?.n || 0);
    },

    async getByJobId(jobId: string) {
      const result = await db.query("SELECT * FROM production_runs WHERE job_id=$1", [jobId]);
      return result.rows[0] ? mapRun(result.rows[0]) : null;
    },

    async approvedJob(jobId: string) {
      const result = await db.query("SELECT snapshot FROM content_jobs WHERE id=$1", [jobId]);
      if (!result.rows[0]) throw new ProductionConflictError("Content-Job nicht gefunden.");
      const job = parseJob(result.rows[0].snapshot);
        requireJobProduct(job);
      if (job.status !== "approved" || job.content?.format !== "video") throw new ProductionConflictError("Freigegebener Video-Plan fehlt.");
      return job;
    },

    async latestApproval(jobId: string) {
      const result = await db.query("SELECT * FROM approval_requests WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1", [jobId]);
      return result.rows[0] ? mapApproval(result.rows[0]) : null;
    },

    async prepareVideo(jobId: string) {
      return db.transaction(async sql => {
        const jobResult = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE", [jobId]);
        if (!jobResult.rows.length) throw new ProductionConflictError("Content-Job nicht gefunden.");
        const job = parseJob(jobResult.rows[0].snapshot);
        requireJobProduct(job);
        if (job.status !== "approved") throw new ProductionConflictError("Vor Medienproduktion muss der Content-Plan gespeichert freigegeben sein.");
        if (job.content?.format !== "video") throw new ProductionConflictError("Dieser Produktionsweg ist derzeit nur für freigegebene Video-Pläne vorgesehen.");

        const existing = await sql.query("SELECT * FROM production_runs WHERE job_id=$1", [jobId]);
        const count = await sql.query("SELECT count(*) AS n FROM production_runs WHERE content_type='video' AND status='ready'");
        const successfulVideos = Number(count.rows[0]?.n || 0);
        const decision = chooseVideoProvider(successfulVideos);
        if (existing.rows[0]) return { run: mapRun(existing.rows[0]), decision };

        const id = crypto.randomUUID();
        const created = await sql.query(
          `INSERT INTO production_runs(id,job_id,content_type,provider,provider_mode,status)
           VALUES($1,$2,'video',$3,$4,'needs_provider_quote') RETURNING *`,
          [id, jobId, decision.provider, decision.mode],
        );
        return { run: mapRun(created.rows[0]), decision };
      });
    },

    async createRenderApproval(input: {
      jobId: string;
      estimatedCostCents: number | null;
      estimatedProviderCredits: number | null;
      estimatedCommissionCents: number | null;
      summary: string;
      approverWaId: string;
      script?: string;
      voiceId?: string;
    }) {
      return db.transaction(async sql => {
        const runResult = await sql.query("SELECT * FROM production_runs WHERE job_id=$1 FOR UPDATE", [input.jobId]);
        if (!runResult.rows.length) throw new ProductionConflictError("Produktionsauftrag zuerst vorbereiten.");
        const run = mapRun(runResult.rows[0]);
        if (!["needs_provider_quote", "changes_requested"].includes(run.status)) {
          throw new ProductionConflictError("Für diesen Produktionsauftrag kann derzeit keine neue Render-Freigabe angefordert werden.");
        }
        if (run.providerMode !== "FACELESS_STORYBOARD" || !input.script || !input.voiceId || !input.estimatedProviderCredits) {
          throw new ProductionConflictError("Faceless.so-Quote, Sprecher und freigegebener Entwurf fehlen.");
        }
        const jobResult = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE", [input.jobId]);
        if (!jobResult.rows[0]) throw new ProductionConflictError("Content-Job nicht gefunden.");
        const job = parseJob(jobResult.rows[0].snapshot);
        requireJobProduct(job);
        if (job.status !== "approved" || job.content?.format !== "video") throw new ProductionConflictError("Freigegebener Video-Plan fehlt.");
        if (job.content.scenes.map(scene => scene.audio.trim()).join("\n\n") !== input.script) {
          throw new ProductionConflictError("Der Entwurf wurde seit der Quote geändert.");
        }
        if (run.status === "changes_requested" && input.script === runResult.rows[0].provider_script) {
          throw new ProductionConflictError("Änderungswunsch erst im Content-Plan überarbeiten und erneut freigeben.");
        }
        const pending = await sql.query("SELECT * FROM approval_requests WHERE production_run_id=$1 AND kind='render' AND status='pending'", [run.id]);
        if (pending.rows[0]) return mapApproval(pending.rows[0]);

        const id = crypto.randomUUID();
        const token = randomBytes(18).toString("base64url");
        const result = await sql.query(
          `INSERT INTO approval_requests(id,production_run_id,job_id,kind,status,approval_token,estimated_cost_cents,estimated_commission_cents,summary,approver_wa_id)
           VALUES($1,$2,$3,'render','pending',$4,$5,$6,$7,$8) RETURNING *`,
          [id, run.id, input.jobId, token, input.estimatedCostCents, input.estimatedCommissionCents, input.summary, input.approverWaId],
        );
        await sql.query(
          "UPDATE production_runs SET status='awaiting_whatsapp_approval',estimated_cost_cents=$2,estimated_provider_credits=$3,provider_script=$4,provider_voice_id=$5,revision_request='',updated_at=now() WHERE id=$1",
          [run.id, input.estimatedCostCents, input.estimatedProviderCredits, input.script, input.voiceId],
        );
        return mapApproval(result.rows[0]);
      });
    },

    async claimWhatsAppSend(approvalId: string) {
      const result = await db.query(
        "UPDATE approval_requests SET whatsapp_send_attempted_at=now() WHERE id=$1 AND status='pending' AND whatsapp_message_id IS NULL AND whatsapp_send_attempted_at IS NULL RETURNING id",
        [approvalId],
      );
      if (!result.rows.length) throw new ProductionConflictError("WhatsApp-Versand bereits versucht. Bei unklarem Ergebnis nicht erneut senden.");
    },

    async bindApprovalMessage(approvalId: string, messageId: string) {
      const result = await db.query(
        "UPDATE approval_requests SET whatsapp_message_id=$2 WHERE id=$1 AND status='pending' AND whatsapp_message_id IS NULL RETURNING *",
        [approvalId, messageId],
      );
      if (!result.rows[0]) throw new ProductionConflictError("WhatsApp-Nachricht konnte keiner offenen Freigabe zugeordnet werden.");
      return mapApproval(result.rows[0]);
    },

    async reviseRequestedVideo(jobId: string) {
      return db.transaction(async sql => {
        const run = await sql.query("SELECT * FROM production_runs WHERE job_id=$1 AND status='changes_requested' FOR UPDATE", [jobId]);
        if (!run.rows[0]) throw new ProductionConflictError("Kein offener Änderungsauftrag für diesen Produktionsjob.");
        const stored = await sql.query("SELECT snapshot,event_sequence FROM content_jobs WHERE id=$1 FOR UPDATE", [jobId]);
        if (!stored.rows[0]) throw new ProductionConflictError("Content-Job fehlt.");
        const original = parseJob(stored.rows[0].snapshot);
        let revised;
        try { revised = await reviseApprovedVideo(original, String(run.rows[0].revision_request)); }
        catch (error) { throw new ProductionConflictError(error instanceof Error ? error.message : "Änderung nicht umsetzbar."); }
        const previousSequence = Number(stored.rows[0].event_sequence);
        if (previousSequence !== original.events.length) throw new ProductionConflictError("Content-Protokoll wurde zwischenzeitlich geändert.");
        await sql.query("UPDATE content_jobs SET status='awaiting_approval',snapshot=$2,event_sequence=$3,updated_at=$4 WHERE id=$1", [jobId, JSON.stringify(revised), revised.events.length, revised.updatedAt]);
        for (const event of revised.events.filter(item => item.sequence > previousSequence)) {
          await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)", [jobId, event.sequence, event.agent, event.kind, event.at, JSON.stringify(event)]);
        }
        await sql.query("UPDATE production_runs SET status='needs_provider_quote',revision_request='',updated_at=now() WHERE job_id=$1", [jobId]);
        return revised;
      });
    },

    async applyIncomingWhatsApp(input: { id: string; from: string; body: string; replyToMessageId: string | null; payload: unknown }) {
      const approver = (process.env.WHATSAPP_APPROVER_WA_ID || "").replace(/\D/g, "");
      if (!approver || input.from.replace(/\D/g, "") !== approver) return { handled: false as const, reason: "untrusted_sender" as const };
      return db.transaction(async sql => {
        const inserted = await sql.query(
          "INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(message_id) DO NOTHING RETURNING message_id",
          [input.id, input.from, input.replyToMessageId, input.body, JSON.stringify(input.payload)],
        );
        if (!inserted.rows.length) return { handled: false as const, reason: "duplicate" as const };

        const approvalResult = input.replyToMessageId
          ? await sql.query("SELECT * FROM approval_requests WHERE whatsapp_message_id=$1 AND status='pending' FOR UPDATE", [input.replyToMessageId])
          : await sql.query("SELECT * FROM approval_requests WHERE approver_wa_id=$1 AND status='pending' AND whatsapp_message_id IS NOT NULL ORDER BY created_at DESC LIMIT 2 FOR UPDATE", [input.from]);
        const publicationResult = input.replyToMessageId
          ? await sql.query("SELECT * FROM publication_requests WHERE whatsapp_message_id=$1 AND status='pending' FOR UPDATE", [input.replyToMessageId])
          : await sql.query("SELECT * FROM publication_requests WHERE approver_wa_id=$1 AND status='pending' AND whatsapp_message_id IS NOT NULL ORDER BY created_at DESC LIMIT 2 FOR UPDATE", [input.from]);
        const dailyResult = input.replyToMessageId
          ? await sql.query("SELECT * FROM daily_drafts WHERE whatsapp_message_id=$1 AND status='awaiting_approval' FOR UPDATE", [input.replyToMessageId])
          : await sql.query("SELECT * FROM daily_drafts WHERE status='awaiting_approval' AND whatsapp_message_id IS NOT NULL ORDER BY created_at DESC LIMIT 2 FOR UPDATE", []);
        const notificationResult = input.replyToMessageId
          ? await sql.query("SELECT * FROM daily_drafts WHERE notification_message_id=$1 AND status='awaiting_approval' AND whatsapp_message_id IS NULL FOR UPDATE", [input.replyToMessageId])
          : await sql.query("SELECT * FROM daily_drafts WHERE notification_message_id IS NOT NULL AND status='awaiting_approval' AND whatsapp_message_id IS NULL ORDER BY created_at DESC LIMIT 2 FOR UPDATE", []);
        const weeklyResult = input.replyToMessageId
          ? await sql.query("SELECT * FROM weekly_reports WHERE notification_message_id=$1 AND status='notification_sent' AND whatsapp_message_id IS NULL FOR UPDATE", [input.replyToMessageId])
          : await sql.query("SELECT * FROM weekly_reports WHERE notification_message_id IS NOT NULL AND status='notification_sent' AND whatsapp_message_id IS NULL ORDER BY created_at DESC LIMIT 2 FOR UPDATE", []);
        if (!input.replyToMessageId && approvalResult.rows.length + publicationResult.rows.length + dailyResult.rows.length + notificationResult.rows.length + weeklyResult.rows.length !== 1) return { handled: false as const, reason: "ambiguous_approval" as const };
        if (!approvalResult.rows[0] && !publicationResult.rows[0] && !dailyResult.rows[0] && !notificationResult.rows[0] && !weeklyResult.rows[0]) return { handled: false as const, reason: "no_pending_approval" as const };

        if (weeklyResult.rows[0]) {
          if (input.body.trim().toLocaleLowerCase("de-DE").replace(/[.!?]+$/, "") !== "wochenbilanz") {
            return { handled: false as const, reason: "weekly_notification_requires_request" as const };
          }
          await sql.query("UPDATE whatsapp_events SET intent='weekly_report_reply' WHERE message_id=$1", [input.id]);
          const weekStart = new Date(String(weeklyResult.rows[0].week_start)).toISOString().slice(0, 10);
          return { handled: true as const, intent: "weekly_report_reply" as const, weeklyReportWeekStart: weekStart };
        }

        if (notificationResult.rows[0]) {
          // The generic template never contains an approvable draft. Only a
          // request for the full draft can trigger the later approval message.
          if (input.body.trim().toLocaleLowerCase("de-DE").replace(/[.!?]+$/, "") !== "entwurf") {
            return { handled: false as const, reason: "notification_requires_entwurf" as const };
          }
          await sql.query("UPDATE whatsapp_events SET intent='notification_reply' WHERE message_id=$1", [input.id]);
          return { handled: true as const, intent: "notification_reply" as const, dailyNotificationJobId: String(notificationResult.rows[0].job_id) };
        }

        if (dailyResult.rows[0]) {
          const daily = dailyResult.rows[0];
          const decision = classifyWhatsAppReply(input.body);
          const status = decision.intent === "approve" ? "content_approved" : decision.intent === "reject" ? "rejected" : "changes_requested";
          if (decision.intent === "approve") {
            const stored = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE", [daily.job_id]);
            if (!stored.rows[0]) throw new ProductionConflictError("Tages-Content-Job fehlt.");
            const job = parseJob(stored.rows[0].snapshot);
        requireJobProduct(job);
            if (job.status !== "awaiting_approval") throw new ProductionConflictError("Tagesentwurf wurde bereits verändert.");
            job.status = "approved"; job.updatedAt = new Date().toISOString();
            const event = { sequence: job.events.length+1, at: job.updatedAt, agent: "orchestrator" as const,
              kind: "decision" as const, message: "Content-Plan nach eindeutiger WhatsApp-Freigabe genehmigt; separate Veröffentlichungsfreigabe folgt." };
            job.events.push(event);
            await sql.query("UPDATE content_jobs SET status='approved',snapshot=$2,event_sequence=$3,updated_at=$4 WHERE id=$1", [job.id,JSON.stringify(job),event.sequence,job.updatedAt]);
            await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)", [job.id,event.sequence,event.agent,event.kind,event.at,JSON.stringify(event)]);
          }
          await sql.query("UPDATE daily_drafts SET status=$2,feedback=$3,updated_at=now() WHERE day=$1", [daily.day,status,decision.feedback]);
          await sql.query("UPDATE whatsapp_events SET intent=$2 WHERE message_id=$1", [input.id,decision.intent]);
          return { handled: true as const, intent: decision.intent, feedback: decision.feedback, dailyJobId: String(daily.job_id) };
        }

        if (publicationResult.rows[0]) {
          const publication = publicationResult.rows[0];
          const decision = classifyWhatsAppReply(input.body);
          if (decision.intent === "approve") {
            const stored = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE", [publication.job_id]);
            if (!stored.rows[0]) throw new ProductionConflictError("product_unresolved");
            requireJobProduct(parseJob(stored.rows[0].snapshot));
          }
          const status = decision.intent === "approve" ? "approved" : decision.intent === "reject" ? "rejected" : "changes_requested";
          await sql.query("UPDATE publication_requests SET status=$2,feedback=$3,decided_at=now(),updated_at=now() WHERE id=$1", [publication.id,status,decision.feedback]);
          await sql.query("UPDATE whatsapp_events SET intent=$2,approval_request_id=NULL WHERE message_id=$1", [input.id,decision.intent]);
          return { handled: true as const, intent: decision.intent, feedback: decision.feedback,
            publicationId: String(publication.id), jobId: String(publication.job_id), platform: String(publication.platform) };
        }

        const approval = mapApproval(approvalResult.rows[0]);
        const decision = classifyWhatsAppReply(input.body);
        if (decision.intent === "approve") {
          const stored = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE", [approval.jobId]);
          if (!stored.rows[0]) throw new ProductionConflictError("product_unresolved");
          requireJobProduct(parseJob(stored.rows[0].snapshot));
        }
        const approvalStatus = decision.intent === "approve" ? "approved" : decision.intent === "reject" ? "rejected" : "changes_requested";
        const runStatus = decision.intent === "approve" ? "approved_for_spend" : decision.intent === "reject" ? "cancelled" : "changes_requested";
        if (approval.kind !== "render") return { handled: false as const, reason: "unsupported_approval_kind" as const };
        await sql.query(
          "UPDATE approval_requests SET status=$2,feedback=$3,decided_at=now() WHERE id=$1",
          [approval.id, approvalStatus, decision.feedback],
        );
        await sql.query(
          "UPDATE production_runs SET status=$2,revision_request=$3,updated_at=now() WHERE id=$1",
          [approval.productionRunId, runStatus, decision.feedback],
        );
        await sql.query(
          "UPDATE whatsapp_events SET intent=$2,production_run_id=$3,approval_request_id=$4 WHERE message_id=$1",
          [input.id, decision.intent, approval.productionRunId, approval.id],
        );
        return { handled: true as const, intent: decision.intent, feedback: decision.feedback, productionRunId: approval.productionRunId, approvalId: approval.id };
      });
    },

    async claimPaidCreation(jobId: string, maxCredits: number) {
      return db.transaction(async sql => {
        const result = await sql.query(
          `SELECT r.* FROM production_runs r JOIN approval_requests a ON a.production_run_id=r.id
           WHERE r.job_id=$1 AND r.status='approved_for_spend' AND r.provider_mode='FACELESS_STORYBOARD'
             AND r.provider_request_attempted_at IS NULL AND r.estimated_provider_credits >= $2
             AND r.provider_script IS NOT NULL AND r.provider_voice_id IS NOT NULL
             AND a.kind='render' AND a.status='approved' AND a.whatsapp_message_id IS NOT NULL
           FOR UPDATE OF r`, [jobId, maxCredits],
        );
        if (!result.rows[0]) throw new ProductionConflictError("Bezahlten Videostart ohne eindeutige WhatsApp-Freigabe oder bei geänderter Quote verweigert.");
        const stored = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE", [jobId]);
        if (!stored.rows[0]) throw new ProductionConflictError("product_unresolved");
        const job = parseJob(stored.rows[0].snapshot);
        requireJobProduct(job);
        if (job.status !== "approved" || job.content?.format !== "video" || job.content.scenes.map(s => s.audio.trim()).join("\n\n") !== result.rows[0].provider_script) throw new ProductionConflictError("Produkt oder Drehbuch geändert.");
        const key = crypto.randomUUID();
        const claimed = await sql.query(
          "UPDATE production_runs SET status='rendering',provider_request_key=$2,provider_request_attempted_at=now(),updated_at=now() WHERE id=$1 AND status='approved_for_spend' RETURNING *",
          [result.rows[0].id, key],
        );
        await sql.query("UPDATE approval_requests SET status='consumed' WHERE production_run_id=$1 AND kind='render' AND status='approved'", [result.rows[0].id]);
        return { run: mapRun(claimed.rows[0]), script: String(result.rows[0].provider_script), voiceId: String(result.rows[0].provider_voice_id), key };
      });
    },

    async bindProviderJob(runId: string, providerJobId: string) {
      const result = await db.query("UPDATE production_runs SET provider_job_id=$2,updated_at=now() WHERE id=$1 AND status='rendering' AND provider_request_attempted_at IS NOT NULL AND provider_job_id IS NULL RETURNING *", [runId, providerJobId]);
      if (!result.rows[0]) throw new ProductionConflictError("Provider-Auftrag konnte nicht eindeutig zugeordnet werden.");
      return mapRun(result.rows[0]);
    },

    async claimFreeRender(runId: string) {
      const result = await db.query("UPDATE production_runs SET render_request_key=$2,render_request_attempted_at=now(),updated_at=now() WHERE id=$1 AND status='rendering' AND provider_job_id IS NOT NULL AND render_request_attempted_at IS NULL RETURNING *", [runId, crypto.randomUUID()]);
      if (!result.rows[0]) throw new ProductionConflictError("MP4-Render bereits versucht; bei unklarem Ergebnis manuell prüfen.");
      const key = await db.query("SELECT render_request_key FROM production_runs WHERE id=$1", [runId]);
      return { run: mapRun(result.rows[0]), key: String(key.rows[0].render_request_key) };
    },

    async bindRender(runId: string, renderId: string) {
      const result = await db.query("UPDATE production_runs SET render_id=$2,updated_at=now() WHERE id=$1 AND status='rendering' AND render_request_attempted_at IS NOT NULL AND render_id IS NULL RETURNING *", [runId, renderId]);
      if (!result.rows[0]) throw new ProductionConflictError("MP4-Render konnte nicht zugeordnet werden.");
      return mapRun(result.rows[0]);
    },

    async providerProgress(jobId: string) {
      const result = await db.query("SELECT render_id,render_request_attempted_at FROM production_runs WHERE job_id=$1", [jobId]);
      return result.rows[0] ? { renderId: result.rows[0].render_id as string | null, renderAttempted: !!result.rows[0].render_request_attempted_at } : null;
    },

    async markFailed(runId: string) {
      await db.query("UPDATE production_runs SET status='failed',updated_at=now() WHERE id=$1 AND status='rendering'", [runId]);
    },

    async markReady(runId: string, outputUrl: string) {
      const result = await db.query(
        "UPDATE production_runs SET status='ready',output_url=$2,updated_at=now() WHERE id=$1 AND status='rendering' RETURNING *",
        [runId, outputUrl],
      );
      if (!result.rows[0]) throw new ProductionConflictError("Nur ein laufender Render kann als fertig markiert werden.");
      return mapRun(result.rows[0]);
    },
  };
}
