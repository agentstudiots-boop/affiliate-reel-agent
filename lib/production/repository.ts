import { randomBytes } from "node:crypto";
import { parseJob } from "../content/history";
import { getDatabase, type Database } from "../memory/db";
import { chooseVideoProvider } from "./policy";
import { approvalRequestSchema, productionRunSchema, type ApprovalRequest, type ProductionRun } from "./schema";
import { classifyWhatsAppReply } from "../whatsapp/intent";

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

    async latestApproval(jobId: string) {
      const result = await db.query("SELECT * FROM approval_requests WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1", [jobId]);
      return result.rows[0] ? mapApproval(result.rows[0]) : null;
    },

    async prepareVideo(jobId: string) {
      return db.transaction(async sql => {
        const jobResult = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE", [jobId]);
        if (!jobResult.rows.length) throw new ProductionConflictError("Content-Job nicht gefunden.");
        const job = parseJob(jobResult.rows[0].snapshot);
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
      estimatedCostCents: number;
      estimatedProviderCredits: number | null;
      estimatedCommissionCents: number | null;
      summary: string;
      approverWaId: string;
    }) {
      return db.transaction(async sql => {
        const runResult = await sql.query("SELECT * FROM production_runs WHERE job_id=$1 FOR UPDATE", [input.jobId]);
        if (!runResult.rows.length) throw new ProductionConflictError("Produktionsauftrag zuerst vorbereiten.");
        const run = mapRun(runResult.rows[0]);
        if (!["needs_provider_quote", "changes_requested"].includes(run.status)) {
          throw new ProductionConflictError("Für diesen Produktionsauftrag kann derzeit keine neue Render-Freigabe angefordert werden.");
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
          "UPDATE production_runs SET status='awaiting_whatsapp_approval',estimated_cost_cents=$2,estimated_provider_credits=$3,revision_request='',updated_at=now() WHERE id=$1",
          [run.id, input.estimatedCostCents, input.estimatedProviderCredits],
        );
        return mapApproval(result.rows[0]);
      });
    },

    async bindApprovalMessage(approvalId: string, messageId: string) {
      const result = await db.query(
        "UPDATE approval_requests SET whatsapp_message_id=$2 WHERE id=$1 AND status='pending' AND whatsapp_message_id IS NULL RETURNING *",
        [approvalId, messageId],
      );
      if (!result.rows[0]) throw new ProductionConflictError("WhatsApp-Nachricht konnte keiner offenen Freigabe zugeordnet werden.");
      return mapApproval(result.rows[0]);
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
          : await sql.query("SELECT * FROM approval_requests WHERE approver_wa_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [input.from]);
        if (!approvalResult.rows[0]) return { handled: false as const, reason: "no_pending_approval" as const };

        const approval = mapApproval(approvalResult.rows[0]);
        const decision = classifyWhatsAppReply(input.body);
        const approvalStatus = decision.intent === "approve" ? "approved" : decision.intent === "reject" ? "rejected" : "changes_requested";
        const runStatus = decision.intent === "approve" ? "approved_for_spend" : decision.intent === "reject" ? "cancelled" : "changes_requested";
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

    async markRendering(runId: string, providerJobId: string) {
      const result = await db.query(
        "UPDATE production_runs SET status='rendering',provider_job_id=$2,updated_at=now() WHERE id=$1 AND status='approved_for_spend' RETURNING *",
        [runId, providerJobId],
      );
      if (!result.rows[0]) throw new ProductionConflictError("Render darf ohne gespeicherte WhatsApp-Freigabe nicht gestartet werden.");
      return mapRun(result.rows[0]);
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
