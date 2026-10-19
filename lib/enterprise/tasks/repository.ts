// Task ledger repository of the executive kernel (task B-03) on the tables of migration 039.
//
// At-least-once delivery with fencing: a worker leases a task (holder + monotonic fencing token) and may only change it
// while it holds the current token and the lease has not expired. Every state change writes its event – and, for
// completions, its outbox entries – in the same transaction; no transaction is held across a department call.
// outcome_unknown is final for automation: it is never retried. Expired leases are requeued while attempts remain,
// otherwise the task becomes dead (manual review). Nothing here is wired into the app; time is passed in by the caller.

import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../memory/db";
import { checkEnvelope, checkResult, type TaskEnvelope } from "../contract";

export type TaskCreator = "operator" | "executive" | "cron" | "department";
export type Lease = { id: string; holder: string; fencingToken: number };
export type LeasedTask = Lease & { envelope: TaskEnvelope; attempts: number; maxAttempts: number; leaseUntil: string };
export type OutboxDraft = { kind: string; payload: Record<string, unknown>; idempotencyKey: string };
export type CompletionOutcome = "succeeded" | "failed" | "requeued" | "outcome_unknown";

export class RepositoryError extends Error {}

// Failure classes that may be retried automatically while attempts remain. outcome_unknown never is.
const RETRYABLE = new Set(["provider_error"]);
const MAX_LEASE_MS = 15 * 60 * 1000;

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const later = (now: Date, ms: number) => new Date(now.getTime() + ms).toISOString();
const json = (value: unknown) => JSON.stringify(value);

function validLease(ms: number) {
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > MAX_LEASE_MS) throw new RepositoryError(`Lease-Dauer ungültig: ${ms}`);
}

async function event(sql: Sql, taskId: string, kind: string, actor: string, now: Date, fencingToken: number | null, detail: Record<string, unknown> = {}) {
  // The caller holds the task row lock, so max(seq)+1 cannot race.
  await sql.query(`INSERT INTO enterprise_task_events(task_id,seq,kind,actor,fencing_token,detail,created_at)
    SELECT $1, coalesce(max(seq),0)+1, $2, $3, $4, $5::jsonb, $6::timestamptz FROM enterprise_task_events WHERE task_id=$1`,
    [taskId, kind, actor.slice(0, 100), fencingToken, json(detail), now.toISOString()]);
}

export async function enqueueTask(db: Database, input: { envelope: unknown; createdBy: TaskCreator; priority?: number; maxAttempts?: number;
  parentId?: string | null; planId?: string | null }, now: Date): Promise<{ id: string; created: boolean }> {
  const checked = checkEnvelope(input.envelope);
  if (!checked.ok) throw new RepositoryError(`Envelope abgelehnt: ${checked.reason}`);
  const envelope = checked.envelope;
  return db.transaction(async sql => {
    const id = randomUUID();
    const inserted = await sql.query(`INSERT INTO enterprise_tasks(id,department,task_kind,handler_id,permission_level,parent_id,plan_id,correlation_id,
        idempotency_key,input,max_cost_cents,max_model_calls,max_attempts,priority,deadline,created_by,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15::timestamptz,$16,$17::timestamptz,$17::timestamptz)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [id, envelope.to, envelope.taskKind, envelope.handlerId, envelope.permissionLevel, input.parentId ?? null, input.planId ?? null,
        envelope.correlationId, envelope.idempotencyKey, json(envelope), envelope.budget.maxCostCents, envelope.budget.maxModelCalls,
        input.maxAttempts ?? 1, input.priority ?? 0, envelope.budget.deadline, input.createdBy, now.toISOString()]);
    if (inserted.rows.length) {
      await event(sql, id, "created", input.createdBy, now, null, { taskKind: envelope.taskKind, level: envelope.permissionLevel });
      return { id, created: true };
    }
    // Same idempotency key again: the existing task is returned, but only if it is the same task.
    const existing = (await sql.query("SELECT id,department,task_kind,handler_id FROM enterprise_tasks WHERE idempotency_key=$1", [envelope.idempotencyKey])).rows[0];
    if (!existing || existing.department !== envelope.to || existing.task_kind !== envelope.taskKind || existing.handler_id !== envelope.handlerId)
      throw new RepositoryError("Idempotenzschlüssel gehört zu einer anderen Aufgabe");
    return { id: String(existing.id), created: false };
  });
}

// Leases the next runnable task. The stored envelope is checked again against the current registry, so a task kind that
// was restricted after enqueueing (e.g. raised to a decision level) is rejected instead of run.
export async function leaseNext(db: Database, holder: string, now: Date, leaseMs: number): Promise<LeasedTask | null> {
  validLease(leaseMs);
  if (!holder.trim()) throw new RepositoryError("Lease-Halter fehlt");
  for (let skipped = 0; skipped < 20; skipped++) {
    const result = await db.transaction(async sql => {
      const row = (await sql.query(`SELECT id,input,attempts,max_attempts FROM enterprise_tasks
        WHERE status='queued' AND attempts < max_attempts AND (deadline IS NULL OR deadline > $1::timestamptz)
        ORDER BY priority DESC, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`, [now.toISOString()])).rows[0];
      if (!row) return { done: true as const, task: null };
      const checked = checkEnvelope(row.input);
      if (!checked.ok) {
        await sql.query(`UPDATE enterprise_tasks SET status='failed',failure_class='invalid_input',output=$2::jsonb,updated_at=$3::timestamptz WHERE id=$1`,
          [row.id, json({ rejected: checked.reason }), now.toISOString()]);
        await event(sql, String(row.id), "rejected_on_lease", "kernel", now, null, { reason: checked.reason });
        return { done: false as const, task: null };
      }
      const leased = (await sql.query(`UPDATE enterprise_tasks SET status='leased',lease_holder=$2,lease_until=$3::timestamptz,attempts=attempts+1,
          fencing_token=fencing_token+1,updated_at=$4::timestamptz WHERE id=$1 RETURNING fencing_token,attempts,max_attempts,lease_until`,
        [row.id, holder, later(now, leaseMs), now.toISOString()])).rows[0];
      const fencingToken = Number(leased.fencing_token);
      await event(sql, String(row.id), "leased", holder, now, fencingToken, { attempt: Number(leased.attempts) });
      return { done: true as const, task: { id: String(row.id), holder, fencingToken, envelope: checked.envelope, attempts: Number(leased.attempts),
        maxAttempts: Number(leased.max_attempts), leaseUntil: iso(leased.lease_until) } };
    });
    if (result.done) return result.task;
  }
  return null;
}

// Locks the task row if the caller still holds the current, unexpired lease.
async function lockLease(sql: Sql, lease: Lease, now: Date, statuses: string[]) {
  const row = (await sql.query(`SELECT id,input,status,attempts,max_attempts FROM enterprise_tasks WHERE id=$1 AND lease_holder=$2 AND fencing_token=$3
    AND lease_until > $4::timestamptz AND status = ANY($5::text[]) FOR UPDATE`, [lease.id, lease.holder, lease.fencingToken, now.toISOString(), statuses])).rows[0];
  return row ?? null;
}

export async function startTask(db: Database, lease: Lease, now: Date): Promise<boolean> {
  return db.transaction(async sql => {
    if (!await lockLease(sql, lease, now, ["leased"])) return false;
    await sql.query("UPDATE enterprise_tasks SET status='running',updated_at=$2::timestamptz WHERE id=$1", [lease.id, now.toISOString()]);
    await event(sql, lease.id, "started", lease.holder, now, lease.fencingToken);
    return true;
  });
}

export async function heartbeat(db: Database, lease: Lease, now: Date, leaseMs: number): Promise<boolean> {
  validLease(leaseMs);
  return db.transaction(async sql => {
    if (!await lockLease(sql, lease, now, ["leased", "running"])) return false;
    await sql.query("UPDATE enterprise_tasks SET lease_until=$2::timestamptz,updated_at=$3::timestamptz WHERE id=$1", [lease.id, later(now, leaseMs), now.toISOString()]);
    return true;
  });
}

// Records a department result. A stale holder, an old fencing token or an expired lease changes nothing.
export async function completeTask(db: Database, lease: Lease, rawResult: unknown, now: Date, outbox: readonly OutboxDraft[] = []):
  Promise<{ ok: true; outcome: CompletionOutcome } | { ok: false; reason: "stale_lease" }> {
  return db.transaction(async sql => {
    const row = await lockLease(sql, lease, now, ["leased", "running"]);
    if (!row) return { ok: false as const, reason: "stale_lease" as const };
    const at = now.toISOString();
    const envelope = row.input as TaskEnvelope;
    const checked = checkResult(rawResult, envelope);
    const finish = async (status: string, failureClass: string | null, output: unknown, kind: string, detail: Record<string, unknown>) => {
      await sql.query(`UPDATE enterprise_tasks SET status=$2,failure_class=$3,output=$4::jsonb,lease_holder=NULL,lease_until=NULL,updated_at=$5::timestamptz WHERE id=$1`,
        [lease.id, status, failureClass, output === null ? null : json(output), at]);
      await event(sql, lease.id, kind, lease.holder, now, lease.fencingToken, detail);
    };
    if (!checked.ok) {
      // Over budget or malformed: never accepted as success; the actual usage is kept for the cost ledger.
      const failureClass = checked.usage && /Budget/.test(checked.reason) ? "budget_exhausted" : "internal";
      await finish("failed", failureClass, { rejected: checked.reason, usage: checked.usage ?? null }, "failed", { reason: checked.reason, failureClass });
      return { ok: true as const, outcome: "failed" as const };
    }
    const result = checked.result;
    const usage = { usedCostCents: result.usedCostCents, usedModelCalls: result.usedModelCalls };
    if (result.status === "succeeded") {
      await finish("succeeded", null, { output: result.output, evidence: result.evidence, ...usage }, "succeeded", usage);
      for (const draft of outbox)
        await sql.query(`INSERT INTO enterprise_outbox(id,task_id,kind,payload,idempotency_key,fencing_token,created_at) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::timestamptz)`,
          [randomUUID(), lease.id, draft.kind, json(draft.payload), draft.idempotencyKey, lease.fencingToken, at]);
      return { ok: true as const, outcome: "succeeded" as const };
    }
    const detail = { failureClass: result.failureClass, reason: result.reason, ...usage };
    if (result.failureClass === "outcome_unknown") {
      await finish("outcome_unknown", "outcome_unknown", detail, "outcome_unknown", detail);
      return { ok: true as const, outcome: "outcome_unknown" as const };
    }
    if (RETRYABLE.has(result.failureClass) && Number(row.attempts) < Number(row.max_attempts)) {
      await finish("queued", null, null, "requeued", detail);
      return { ok: true as const, outcome: "requeued" as const };
    }
    await finish("failed", result.failureClass, detail, "failed", detail);
    return { ok: true as const, outcome: "failed" as const };
  });
}

// Expired leases go back to the queue while attempts remain, otherwise to dead (manual review). Queued tasks past their
// deadline fail with deadline_exceeded. Each change is fenced by a new token so a late worker cannot commit afterwards.
export async function reclaimExpired(db: Database, now: Date): Promise<{ requeued: string[]; dead: string[]; expired: string[] }> {
  return db.transaction(async sql => {
    const at = now.toISOString();
    const requeued: string[] = [], dead: string[] = [], expired: string[] = [];
    const stale = (await sql.query(`SELECT id,attempts,max_attempts,lease_holder,fencing_token FROM enterprise_tasks
      WHERE status IN ('leased','running') AND lease_until <= $1::timestamptz ORDER BY lease_until LIMIT 100 FOR UPDATE SKIP LOCKED`, [at])).rows;
    for (const row of stale) {
      const again = Number(row.attempts) < Number(row.max_attempts);
      const updated = (await sql.query(`UPDATE enterprise_tasks SET status=$2,failure_class=$3,lease_holder=NULL,lease_until=NULL,fencing_token=fencing_token+1,
          updated_at=$4::timestamptz WHERE id=$1 RETURNING fencing_token`, [row.id, again ? "queued" : "dead", again ? null : "internal", at])).rows[0];
      await event(sql, String(row.id), again ? "lease_expired" : "dead", "kernel", now, Number(updated.fencing_token), { previousHolder: String(row.lease_holder) });
      (again ? requeued : dead).push(String(row.id));
    }
    const late = (await sql.query(`SELECT id FROM enterprise_tasks WHERE status='queued' AND deadline IS NOT NULL AND deadline <= $1::timestamptz
      ORDER BY deadline LIMIT 100 FOR UPDATE SKIP LOCKED`, [at])).rows;
    for (const row of late) {
      await sql.query(`UPDATE enterprise_tasks SET status='failed',failure_class='deadline_exceeded',updated_at=$2::timestamptz WHERE id=$1`, [row.id, at]);
      await event(sql, String(row.id), "deadline_exceeded", "kernel", now, null);
      expired.push(String(row.id));
    }
    return { requeued, dead, expired };
  });
}

export async function cancelTask(db: Database, id: string, actor: string, now: Date): Promise<boolean> {
  return db.transaction(async sql => {
    const row = (await sql.query("SELECT id FROM enterprise_tasks WHERE id=$1 AND status='queued' FOR UPDATE", [id])).rows[0];
    if (!row) return false;
    await sql.query("UPDATE enterprise_tasks SET status='cancelled',updated_at=$2::timestamptz WHERE id=$1", [id, now.toISOString()]);
    await event(sql, id, "cancelled", actor, now, null);
    return true;
  });
}
