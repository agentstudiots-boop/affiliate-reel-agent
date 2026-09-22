import { createHash } from "node:crypto";
import type { ContentJob, Opportunity } from "../content/schema";
import { parseJob } from "../content/history";
import { getDatabase, type Database } from "./db";
import { evaluateHistory } from "./learning";
import { performanceSchema, type HistoricalCase, type PerformanceInput } from "./schema";

export class ConflictError extends Error {}
export function productId(source: string) {
  const url = new URL(source);
  const asin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1];
  if (asin && /(^|\.)amazon\.de$/i.test(url.hostname)) return `amazon.de:${asin.toUpperCase()}`;
  for (const key of [...url.searchParams.keys()]) if (/^(tag|ref|ref_|utm_|linkCode|camp|creative|qid|sr)/i.test(key)) url.searchParams.delete(key);
  url.hash = ""; url.searchParams.sort();
  return `url:${createHash("sha256").update(url.toString()).digest("hex")}`;
}
export function memoryRepository(db: Database = getDatabase()) {
  return {
    async claim(id: string, opportunity: Opportunity, mode: "reference"|"ai") {
      const now = new Date().toISOString();
      const job: ContentJob = { version: 1, id, createdAt: now, updatedAt: now, status: "queued", mode, opportunity, events: [], revisions: 0, modelCalls: 0, totalTokens: 0 };
      await db.transaction(async sql => {
        const pid = productId(opportunity.product.sourceUrl);
        await sql.query("INSERT INTO products(id,name,source_url) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING", [pid, opportunity.product.name, opportunity.product.sourceUrl]);
        const result = await sql.query(`INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,$10,$10) ON CONFLICT(id) DO NOTHING RETURNING id`,
          [id,pid,opportunity.category,opportunity.useCaseKey,opportunity.goal,opportunity.targetPlatform,opportunity.trend,JSON.stringify(opportunity),JSON.stringify(job),now]);
        if (!result.rows.length) throw new ConflictError("Dieser Auftrag existiert bereits. Verlauf laden statt erneut starten.");
      });
      return job;
    },
    async save(job: ContentJob) {
      await db.transaction(async sql => {
        const locked = await sql.query("SELECT event_sequence FROM content_jobs WHERE id=$1 FOR UPDATE",[job.id]);
        if (!locked.rows.length) throw new Error("Job fehlt in Postgres.");
        const sequence = job.events.at(-1)?.sequence || 0;
        if (Number(locked.rows[0].event_sequence) >= sequence) return;
        const agents = [...new Set(job.events.map(e => e.agent))];
        await sql.query(`UPDATE content_jobs SET status=$2, content_type=$3, platform_plan=$4, creative=$5,
          decision=$6,decision_reason=$7,agents=$8,snapshot=$9,event_sequence=$10,updated_at=$11 WHERE id=$1`,
          [job.id,job.status,job.content?.format || job.decision?.format || null,job.marketing?.primary || null,
            JSON.stringify(job.ideas?.find(i => i.id===job.decision?.ideaId) || null),JSON.stringify(job.decision || null),job.decision?.reason || null,
            agents,JSON.stringify(job),sequence,job.updatedAt]);
        for (const event of job.events.filter(e => e.sequence > Number(locked.rows[0].event_sequence))) {
          await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING",
            [job.id,event.sequence,event.agent,event.kind,event.at,JSON.stringify(event)]);
        }
      });
    },
    async list(before?: string) {
      // Vercel can terminate a function without executing finally. Recover stale phases on read.
      await db.transaction(async sql => {
        const stale = await sql.query("SELECT snapshot FROM content_jobs WHERE updated_at < now()-interval '10 minutes' AND status IN ('queued','checking','ideating','selecting','producing','reviewing','revising','marketing') FOR UPDATE SKIP LOCKED");
        for (const row of stale.rows) {
          const job = parseJob(row.snapshot);
          job.status = "interrupted"; job.updatedAt = new Date().toISOString();
          const event = { sequence: job.events.length+1, at: job.updatedAt, agent: "orchestrator", kind: "error", message: "Job ohne Abschluss seit mehr als zehn Minuten; kein automatischer Neustart." } as const;
          job.events.push(event);
          await sql.query("UPDATE content_jobs SET status='interrupted',snapshot=$2,event_sequence=$3,updated_at=$4 WHERE id=$1",[job.id,JSON.stringify(job),event.sequence,job.updatedAt]);
          await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)",[job.id,event.sequence,event.agent,event.kind,event.at,JSON.stringify(event)]);
        }
      });
      const result = await db.query("SELECT snapshot FROM content_jobs WHERE ($1::timestamptz IS NULL OR created_at < $1) ORDER BY created_at DESC LIMIT 50",[before || null]);
      return result.rows.map(row => parseJob(row.snapshot));
    },
    async approve(id: string) {
      return db.transaction(async sql => {
        const result = await sql.query("SELECT snapshot FROM content_jobs WHERE id=$1 FOR UPDATE",[id]);
        if (!result.rows.length) throw new ConflictError("Job nicht gefunden.");
        const job = parseJob(result.rows[0].snapshot);
        if (job.status === "approved") return job;
        if (job.status !== "awaiting_approval") throw new ConflictError("Dieser Job ist noch nicht zur Freigabe bereit.");
        job.status = "approved"; job.updatedAt = new Date().toISOString();
        const event = { sequence: job.events.length+1, at: job.updatedAt, agent: "orchestrator" as const, kind: "decision" as const, message: "Nutzer hat den Content-Plan freigegeben; keine Veröffentlichung ausgelöst." };
        job.events.push(event);
        await sql.query("UPDATE content_jobs SET status='approved',snapshot=$2,event_sequence=$3,updated_at=$4 WHERE id=$1",[id,JSON.stringify(job),event.sequence,job.updatedAt]);
        await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)",[id,event.sequence,event.agent,event.kind,event.at,JSON.stringify(event)]);
        return job;
      });
    },
    async performance(jobId: string) {
      const result = await db.query(`SELECT p.*, o.revision,o.window_days,o.finalized,o.clicks,o.conversions,o.affiliate_revenue_cents,o.production_cost_cents,o.profit_cents,o.roi,o.source,o.learning,o.observed_at
        FROM publications p LEFT JOIN LATERAL (SELECT * FROM performance_observations WHERE publication_id=p.id ORDER BY revision DESC LIMIT 1) o ON true WHERE p.job_id=$1`,[jobId]);
      return result.rows;
    },
    async recordPerformance(raw: PerformanceInput) {
      const input = performanceSchema.parse(raw);
      return db.transaction(async sql => {
        const job = await sql.query("SELECT status FROM content_jobs WHERE id=$1 FOR UPDATE",[input.jobId]);
        if (!job.rows.length) throw new ConflictError("Job nicht gefunden.");
        if (input.status !== "draft" && job.rows[0].status !== "approved") throw new ConflictError("Vor Veröffentlichung zuerst den gespeicherten Content-Plan freigeben.");
        const previous = await sql.query(`SELECT p.id,COALESCE(max(o.revision),0) AS revision FROM publications p
          LEFT JOIN performance_observations o ON o.publication_id=p.id WHERE p.job_id=$1 AND p.platform=$2 GROUP BY p.id`,[input.jobId,input.platform]);
        const revision = Number(previous.rows[0]?.revision || 0);
        if (revision !== input.expectedRevision) throw new ConflictError("Messwerte wurden zwischenzeitlich geändert. Bitte neu laden.");
        const publicationId = previous.rows[0]?.id || crypto.randomUUID();
        await sql.query(`INSERT INTO publications(id,job_id,platform,status,url,published_at) VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(job_id,platform) DO UPDATE SET status=EXCLUDED.status,url=EXCLUDED.url,published_at=EXCLUDED.published_at,updated_at=now()`,
          [publicationId,input.jobId,input.platform,input.status,input.url || null,input.publishedAt || null]);
        const result = await sql.query(`INSERT INTO performance_observations(id,publication_id,revision,window_days,finalized,clicks,conversions,affiliate_revenue_cents,production_cost_cents,source,learning)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING revision,profit_cents,roi`,
          [crypto.randomUUID(),publicationId,revision+1,input.windowDays,input.finalized,input.clicks,input.conversions,input.revenueCents,input.costCents,input.source,input.learning]);
        return result.rows[0];
      });
    },
    async learn(opportunity: Opportunity) {
      if (opportunity.category === "general" || opportunity.useCaseKey === "general" || opportunity.targetPlatform === "any") {
        const evidence = evaluateHistory([]); evidence.summary = "Für vergleichbare historische Fälle Kategorie, Anwendungsgruppe und Zielplattform konkret festlegen."; return evidence;
      }
      const result = await db.query(`SELECT j.id AS job_id,j.content_type,p.platform,o.clicks,o.conversions,o.affiliate_revenue_cents,o.production_cost_cents,o.window_days
        FROM content_jobs j JOIN publications p ON p.job_id=j.id
        JOIN LATERAL (SELECT * FROM performance_observations WHERE publication_id=p.id ORDER BY revision DESC LIMIT 1) o ON true
        WHERE j.category=$1 AND j.use_case_key=$2 AND j.goal=$3 AND p.platform=$4
          AND p.status IN ('published','archived') AND j.status='approved' AND j.content_type IS NOT NULL
          AND o.finalized AND o.window_days=30 AND o.production_cost_cents IS NOT NULL
          AND p.published_at + interval '30 days' <= o.observed_at
          AND p.published_at >= now()-interval '180 days'
        ORDER BY p.published_at DESC LIMIT 300`,[opportunity.category,opportunity.useCaseKey,opportunity.goal,opportunity.targetPlatform]);
      const cases: HistoricalCase[] = result.rows.map(row => ({ jobId: String(row.job_id),format: row.content_type as HistoricalCase["format"],platform:String(row.platform), clicks:Number(row.clicks),conversions:Number(row.conversions),revenueCents:Number(row.affiliate_revenue_cents),costCents:Number(row.production_cost_cents),windowDays:Number(row.window_days) }));
      return evaluateHistory(cases);
    },
  };
}
