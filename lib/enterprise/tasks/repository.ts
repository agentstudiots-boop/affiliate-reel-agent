// Task ledger repository of the executive kernel (task B-03) on the tables of migration 039.
//
// At-least-once delivery with fencing: a worker leases a task (holder + monotonic fencing token) and may only change it
// while it holds the current token and the lease has not expired. All times – timestamps, lease expiry and deadlines –
// come from the database clock, never from the caller, so a worker with a stale or skewed clock can neither commit after
// its lease expired nor take a valid lease away. Every state change writes its event in the same transaction; no
// transaction is held across a department call.
//
// Tasks are L0–L2 and have no external effects, so a task result never writes to the outbox; external effects will only
// come from operator decisions (B-06). outcome_unknown is final for automation: it is never retried. A lease that expires
// before the department was started is requeued while attempts remain (otherwise dead, manual review); a task that was
// running when its lease expired may have had effects (e.g. paid model calls) and becomes outcome_unknown.
// Nothing here is wired into the app.

import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../memory/db";
import { checkEnvelope, checkResult, type TaskEnvelope } from "../contract";
import { disputeTaskReservations, settleTaskReservations } from "./budget";

export type TaskCreator = "operator" | "executive" | "cron" | "department";
export type Lease = { id: string; holder: string; fencingToken: number };
export type LeasedTask = Lease & { envelope: TaskEnvelope; attempts: number; maxAttempts: number; leaseUntil: string };
export type CompletionOutcome = "succeeded" | "failed" | "requeued" | "outcome_unknown";

export class RepositoryError extends Error {}

// Failure classes that may be retried automatically while attempts remain. outcome_unknown never is.
const RETRYABLE = new Set(["provider_error"]);
const MAX_LEASE_MS = 15 * 60 * 1000;
const MAX_SKIPPED = 1000;

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const json = (value: unknown) => JSON.stringify(value);

function validLease(ms: number) {
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > MAX_LEASE_MS) throw new RepositoryError(`Lease-Dauer ungültig: ${ms}`);
}

async function event(sql: Sql, taskId: string, kind: string, actor: string, fencingToken: number | null, detail: Record<string, unknown> = {}) {
  // The caller holds the task row lock, so max(seq)+1 cannot race.
  await sql.query(`INSERT INTO enterprise_task_events(task_id,seq,kind,actor,fencing_token,detail)
    SELECT $1, coalesce(max(seq),0)+1, $2, $3, $4, $5::jsonb FROM enterprise_task_events WHERE task_id=$1`,
    [taskId, kind, actor.slice(0, 100), fencingToken, json(detail)]);
}

export async function enqueueTask(db: Database, input: { envelope: unknown; createdBy: TaskCreator; priority?: number; maxAttempts?: number;
  parentId?: string | null; planId?: string | null }): Promise<{ id: string; created: boolean }> {
  const checked = checkEnvelope(input.envelope);
  if (!checked.ok) throw new RepositoryError(`Envelope abgelehnt: ${checked.reason}`);
  const envelope = checked.envelope;
  return db.transaction(async sql => {
    const id = randomUUID();
    const inserted = await sql.query(`INSERT INTO enterprise_tasks(id,department,task_kind,handler_id,permission_level,parent_id,plan_id,correlation_id,
        idempotency_key,input,max_cost_cents,max_model_calls,max_attempts,priority,deadline,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15::timestamptz,$16)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [id, envelope.to, envelope.taskKind, envelope.handlerId, envelope.permissionLevel, input.parentId ?? null, input.planId ?? null,
        envelope.correlationId, envelope.idempotencyKey, json(envelope), envelope.budget.maxCostCents, envelope.budget.maxModelCalls,
        input.maxAttempts ?? 1, input.priority ?? 0, envelope.budget.deadline, input.createdBy]);
    if (inserted.rows.length) {
      await event(sql, id, "created", input.createdBy, null, { taskKind: envelope.taskKind, level: envelope.permissionLevel });
      return { id, created: true };
    }
    // Same idempotency key again: the existing task is returned only if it is the same task (kind, handler, budget, payload).
    const existing = (await sql.query(`SELECT id FROM enterprise_tasks WHERE idempotency_key=$1 AND department=$2 AND task_kind=$3 AND handler_id=$4
        AND input->'budget' = $5::jsonb AND input->'payload' = $6::jsonb`,
      [envelope.idempotencyKey, envelope.to, envelope.taskKind, envelope.handlerId, json(envelope.budget), json(envelope.payload)])).rows[0];
    if (!existing) throw new RepositoryError("Idempotenzschlüssel gehört zu einer anderen Aufgabe");
    return { id: String(existing.id), created: false };
  });
}

// Leases the next runnable task. The stored envelope is checked again against the current registry, so a task kind that
// was restricted after enqueueing (e.g. raised to a decision level) is rejected instead of run.
export async function leaseNext(db: Database, holder: string, leaseMs: number): Promise<LeasedTask | null> {
  validLease(leaseMs);
  if (!holder.trim()) throw new RepositoryError("Lease-Halter fehlt");
  for (let skipped = 0; skipped < MAX_SKIPPED; skipped++) {
    const result = await db.transaction(async sql => {
      const row = (await sql.query(`SELECT id,input FROM enterprise_tasks
        WHERE status='queued' AND attempts < max_attempts AND (deadline IS NULL OR deadline > now())
        ORDER BY priority DESC, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
      if (!row) return { done: true as const, task: null };
      const checked = checkEnvelope(row.input);
      if (!checked.ok) {
        await sql.query(`UPDATE enterprise_tasks SET status='failed',failure_class='invalid_input',output=$2::jsonb,updated_at=now() WHERE id=$1`,
          [row.id, json({ rejected: checked.reason })]);
        await event(sql, String(row.id), "rejected_on_lease", "kernel", null, { reason: checked.reason });
        return { done: false as const, task: null };
      }
      // The lease never outlasts the task's deadline.
      const leased = (await sql.query(`UPDATE enterprise_tasks SET status='leased',lease_holder=$2,
          lease_until=least(now() + make_interval(secs => $3::double precision), coalesce(deadline, 'infinity'::timestamptz)),
          attempts=attempts+1,fencing_token=fencing_token+1,updated_at=now() WHERE id=$1 RETURNING fencing_token,attempts,max_attempts,lease_until`,
        [row.id, holder, leaseMs / 1000])).rows[0];
      const fencingToken = Number(leased.fencing_token);
      await event(sql, String(row.id), "leased", holder, fencingToken, { attempt: Number(leased.attempts) });
      return { done: true as const, task: { id: String(row.id), holder, fencingToken, envelope: checked.envelope, attempts: Number(leased.attempts),
        maxAttempts: Number(leased.max_attempts), leaseUntil: iso(leased.lease_until) } };
    });
    if (result.done) return result.task;
  }
  return null;
}

// Locks the task row if the caller still holds the current lease and it has not expired by the database clock.
async function lockLease(sql: Sql, lease: Lease, statuses: string[]) {
  const row = (await sql.query(`SELECT id,input,status,attempts,max_attempts FROM enterprise_tasks WHERE id=$1 AND lease_holder=$2 AND fencing_token=$3
    AND lease_until > now() AND status = ANY($4::text[]) FOR UPDATE`, [lease.id, lease.holder, lease.fencingToken, statuses])).rows[0];
  return row ?? null;
}

export async function startTask(db: Database, lease: Lease): Promise<boolean> {
  return db.transaction(async sql => {
    if (!await lockLease(sql, lease, ["leased"])) return false;
    await sql.query("UPDATE enterprise_tasks SET status='running',updated_at=now() WHERE id=$1", [lease.id]);
    await event(sql, lease.id, "started", lease.holder, lease.fencingToken);
    return true;
  });
}

export async function heartbeat(db: Database, lease: Lease, leaseMs: number): Promise<boolean> {
  validLease(leaseMs);
  return db.transaction(async sql => {
    if (!await lockLease(sql, lease, ["leased", "running"])) return false;
    await sql.query(`UPDATE enterprise_tasks SET lease_until=least(now() + make_interval(secs => $2::double precision), coalesce(deadline, 'infinity'::timestamptz)),
      updated_at=now() WHERE id=$1`, [lease.id, leaseMs / 1000]);
    return true;
  });
}

// Records a department result. A stale holder, an old fencing token or an expired lease changes nothing.
export async function completeTask(db: Database, lease: Lease, rawResult: unknown):
  Promise<{ ok: true; outcome: CompletionOutcome } | { ok: false; reason: "stale_lease" }> {
  return db.transaction(async sql => {
    const row = await lockLease(sql, lease, ["leased", "running"]);
    if (!row) return { ok: false as const, reason: "stale_lease" as const };
    const envelope = row.input as TaskEnvelope;
    const checked = checkResult(rawResult, envelope);
    const finish = async (status: string, failureClass: string | null, output: unknown, kind: string, detail: Record<string, unknown>) => {
      await sql.query(`UPDATE enterprise_tasks SET status=$2,failure_class=$3,output=$4::jsonb,lease_holder=NULL,lease_until=NULL,updated_at=now() WHERE id=$1`,
        [lease.id, status, failureClass, output === null ? null : json(output)]);
      await event(sql, lease.id, kind, lease.holder, lease.fencingToken, detail);
    };
    if (!checked.ok) {
      // Over budget or malformed: never accepted as success; the actual usage is kept for the cost ledger.
      const usage = checked.usage;
      const overBudget = !!usage && (usage.usedCostCents > envelope.budget.maxCostCents || usage.usedModelCalls > envelope.budget.maxModelCalls);
      const failureClass = overBudget ? "budget_exhausted" : "internal";
      // Reservations follow the result in the same transaction (B-05): known usage settles, unreadable usage disputes.
      if (usage) await settleTaskReservations(sql, lease.id, usage.usedCostCents);
      else await disputeTaskReservations(sql, lease.id);
      await finish("failed", failureClass, { rejected: checked.reason, usage: usage ?? null }, "failed", { reason: checked.reason, failureClass });
      return { ok: true as const, outcome: "failed" as const };
    }
    const result = checked.result;
    const usage = { usedCostCents: result.usedCostCents, usedModelCalls: result.usedModelCalls };
    if (result.status === "failed" && result.failureClass === "outcome_unknown") await disputeTaskReservations(sql, lease.id);
    else await settleTaskReservations(sql, lease.id, result.usedCostCents);
    if (result.status === "succeeded") {
      await finish("succeeded", null, { output: result.output, evidence: result.evidence, ...usage }, "succeeded", usage);
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

// Expired leases by the database clock: never started ⇒ back to the queue while attempts remain, otherwise dead (manual
// review); running ⇒ outcome_unknown, because the department may already have acted. Queued tasks past their deadline
// fail with deadline_exceeded. Each change raises the fencing token so a late worker cannot commit afterwards.
export async function reclaimExpired(db: Database): Promise<{ requeued: string[]; dead: string[]; unknown: string[]; expired: string[] }> {
  return db.transaction(async sql => {
    const requeued: string[] = [], dead: string[] = [], unknown: string[] = [], expired: string[] = [];
    const stale = (await sql.query(`SELECT id,status,attempts,max_attempts,lease_holder FROM enterprise_tasks
      WHERE status IN ('leased','running') AND lease_until <= now() ORDER BY lease_until LIMIT 100 FOR UPDATE SKIP LOCKED`)).rows;
    for (const row of stale) {
      const next = row.status === "running" ? "outcome_unknown" : Number(row.attempts) < Number(row.max_attempts) ? "queued" : "dead";
      const failureClass = next === "outcome_unknown" ? "outcome_unknown" : next === "dead" ? "internal" : null;
      const updated = (await sql.query(`UPDATE enterprise_tasks SET status=$2,failure_class=$3,lease_holder=NULL,lease_until=NULL,fencing_token=fencing_token+1,
          updated_at=now() WHERE id=$1 RETURNING fencing_token`, [row.id, next, failureClass])).rows[0];
      await event(sql, String(row.id), next === "queued" ? "lease_expired" : next, "kernel", Number(updated.fencing_token),
        { previousHolder: String(row.lease_holder), previousStatus: String(row.status) });
      // The worker vanished: whether its paid call happened is unknown, so its open reservations keep counting.
      await disputeTaskReservations(sql, String(row.id));
      (next === "queued" ? requeued : next === "dead" ? dead : unknown).push(String(row.id));
    }
    const late = (await sql.query(`SELECT id FROM enterprise_tasks WHERE status='queued' AND deadline IS NOT NULL AND deadline <= now()
      ORDER BY deadline LIMIT 100 FOR UPDATE SKIP LOCKED`)).rows;
    for (const row of late) {
      await sql.query(`UPDATE enterprise_tasks SET status='failed',failure_class='deadline_exceeded',updated_at=now() WHERE id=$1`, [row.id]);
      await event(sql, String(row.id), "deadline_exceeded", "kernel", null);
      expired.push(String(row.id));
    }
    return { requeued, dead, unknown, expired };
  });
}

export async function cancelTask(db: Database, id: string, actor: string): Promise<boolean> {
  return db.transaction(async sql => {
    const row = (await sql.query("SELECT id FROM enterprise_tasks WHERE id=$1 AND status='queued' FOR UPDATE", [id])).rows[0];
    if (!row) return false;
    await sql.query("UPDATE enterprise_tasks SET status='cancelled',updated_at=now() WHERE id=$1", [id]);
    await event(sql, id, "cancelled", actor, null);
    return true;
  });
}
