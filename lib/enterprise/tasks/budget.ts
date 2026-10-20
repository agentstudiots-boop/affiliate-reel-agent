// Hard budget guard of the executive kernel (task B-05) on budget_reservations (migration 039).
//
// A paid call may only start after its amount is reserved against the department's monthly limit; afterwards the
// reservation is settled with the real amount. An unclear outcome (outcome_unknown, lost response) disputes the
// reservation: it keeps counting against the budget and is never released automatically. Reservations of one department
// and month are serialised by an advisory lock, as in lib/visual/runway-budget.ts. The monthly limit comes only from a
// hard budget (migration 040) whose approved_decision_id names an operator decision (migration 041) that was approved for
// exactly this department, month and amount (budgetSubjectKey in ../decisions, which builds that key and the amount
// shown to the operator from structured input) – never from the caller. Without such a budget the limit is
// 0 and every reservation is refused (task B-09). No provider calls while the lock is held.
// All times come from the database clock, like in the repository (B-03) – including the budget month, which the caller
// cannot choose. Reserving, settling and releasing are bound to the worker's lease (holder + fencing token) of a running
// task: a worker that lost its lease can neither reserve nor free budget. Disputing only makes the guard stricter and
// resolving a dispute is a reconciliation step outside department code; both work by reservation id.

import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../memory/db";

export type Reservation = { id: string; taskId: string; department: string; period: string; amountCents: number };
export type ReserveResult =
  | { ok: true; reservation: Reservation; committedCents: number; limitCents: number }
  | { ok: false; reason: "budget_exhausted" | "no_approved_budget" | "invalid_request" | "task_not_running"; detail: string; committedCents?: number; limitCents?: number };

// Same shape as Lease in ./repository (not imported: the repository imports this module).
export type LeaseRef = { id: string; holder: string; fencingToken: number };
const cents = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// Budget month in the operator's time zone (Europe/Berlin), e.g. "2026-11". For display only: reservations take the month
// from the database clock (BERLIN_PERIOD).
export function periodOf(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find(part => part.type === "year")?.value}-${parts.find(part => part.type === "month")?.value}`;
}

// Everything that still counts against the limit: open and disputed reservations at their reserved amount, settled ones
// at their real amount (which may exceed the reservation). Released reservations no longer count.
const BERLIN_PERIOD = "to_char(now() AT TIME ZONE 'Europe/Berlin', 'YYYY-MM')";

// The binding monthly limit, or null without an approved hard budget (tables of migration 040/041 missing ⇒ null as well).
async function approvedLimit(sql: Sql, department: string, period: string): Promise<number | null> {
  const tables = (await sql.query("SELECT to_regclass('public.budgets') IS NOT NULL AND to_regclass('public.enterprise_decisions') IS NOT NULL AS ok")).rows[0];
  if (tables?.ok !== true) return null;
  const row = (await sql.query(`SELECT b.limit_cents FROM budgets b JOIN enterprise_decisions d ON d.id::text = b.approved_decision_id
    WHERE b.department=$1 AND b.period=$2 AND b.kind='hard' AND d.status='approved' AND d.level='L4' AND d.task_kind='executive.budget_change'
      AND d.subject_key = 'budget:' || b.department || ':' || b.period || ':' || b.limit_cents::text`, [department, period])).rows[0];
  return row ? Number(row.limit_cents) : null;
}

// The running task of exactly this lease, locked; null for a stale, expired or foreign lease.
async function lockRunning(sql: Sql, lease: LeaseRef) {
  return (await sql.query(`SELECT department,max_cost_cents FROM enterprise_tasks WHERE id=$1 AND lease_holder=$2 AND fencing_token=$3
    AND status='running' AND lease_until > now() FOR UPDATE`, [lease.id, lease.holder, lease.fencingToken])).rows[0] ?? null;
}

async function committed(sql: Sql, department: string, period: string) {
  const row = (await sql.query(`SELECT coalesce(sum(CASE WHEN status IN ('reserved','disputed') THEN amount_cents
      WHEN status='settled' THEN settled_amount_cents ELSE 0 END),0)::bigint AS cents
    FROM budget_reservations WHERE department=$1 AND period=$2`, [department, period])).rows[0];
  return Number(row?.cents ?? 0);
}

export async function reserveBudget(db: Database, lease: LeaseRef, request: { amountCents: number }): Promise<ReserveResult> {
  if (!cents(request.amountCents) || request.amountCents === 0) return { ok: false, reason: "invalid_request", detail: "Betrag muss eine positive ganze Zahl in Cent sein" };
  return db.transaction(async sql => {
    // Only the current lease of a started task may reserve; its department is taken from the ledger, not the caller.
    const task = await lockRunning(sql, lease);
    if (!task) return { ok: false as const, reason: "task_not_running" as const, detail: "Aufgabe nicht (mehr) unter dieser Lease in Bearbeitung" };
    const department = String(task.department);
    // All attempts of the task count at their real cost: settled reservations at the settled amount (which may exceed
    // the reservation), open and disputed ones at the reserved amount.
    const already = (await sql.query(`SELECT coalesce(sum(CASE WHEN status='settled' THEN settled_amount_cents ELSE amount_cents END),0)::bigint AS cents
      FROM budget_reservations WHERE task_id=$1 AND status<>'released'`, [lease.id])).rows[0];
    if (Number(already?.cents ?? 0) + request.amountCents > Number(task.max_cost_cents))
      return { ok: false as const, reason: "budget_exhausted" as const, detail: `Aufgabenbudget ${task.max_cost_cents} Cent überschritten` };
    const period = String((await sql.query(`SELECT ${BERLIN_PERIOD} AS period`)).rows[0]?.period);
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`enterprise-budget:${department}:${period}`]);
    const limitCents = await approvedLimit(sql, department, period);
    if (limitCents === null)
      return { ok: false as const, reason: "no_approved_budget" as const, detail: `kein vom Betreiber freigegebenes Monatsbudget ${department} ${period}`, limitCents: 0 };
    const used = await committed(sql, department, period);
    if (used + request.amountCents > limitCents)
      return { ok: false as const, reason: "budget_exhausted" as const, detail: `Monatsbudget ${department} ${period} erschöpft`, committedCents: used, limitCents };
    const id = randomUUID();
    await sql.query(`INSERT INTO budget_reservations(id,task_id,department,period,amount_cents) VALUES($1,$2,$3,$4,$5)`,
      [id, lease.id, department, period, request.amountCents]);
    return { ok: true as const, reservation: { id, taskId: lease.id, department, period, amountCents: request.amountCents },
      committedCents: used + request.amountCents, limitCents };
  });
}

// The call happened and its real cost is known.
export async function settleReservation(db: Database, lease: LeaseRef, id: string, settledAmountCents: number): Promise<boolean> {
  if (!cents(settledAmountCents)) return false;
  return db.transaction(async sql => {
    if (!await lockRunning(sql, lease)) return false;
    const updated = await sql.query(`UPDATE budget_reservations SET status='settled',settled_amount_cents=$3,settled_at=now()
      WHERE id=$1 AND task_id=$2 AND status='reserved' RETURNING id`, [id, lease.id, settledAmountCents]);
    return updated.rows.length === 1;
  });
}

// The call certainly did not happen (e.g. refused before sending). Never for an unclear outcome: a task in
// outcome_unknown keeps its reservations; use disputeReservation instead.
// Bound to the running lease, so a task in outcome_unknown (no lease) can never release.
export async function releaseReservation(db: Database, lease: LeaseRef, id: string): Promise<boolean> {
  return db.transaction(async sql => {
    if (!await lockRunning(sql, lease)) return false;
    const updated = await sql.query(`UPDATE budget_reservations SET status='released',settled_at=now()
      WHERE id=$1 AND task_id=$2 AND status='reserved' RETURNING id`, [id, lease.id]);
    return updated.rows.length === 1;
  });
}

// Outcome unclear: the reservation keeps counting until a person or a reconciliation settles it.
export async function disputeReservation(db: Database, id: string): Promise<boolean> {
  const updated = await db.query("UPDATE budget_reservations SET status='disputed' WHERE id=$1 AND status='reserved' RETURNING id", [id]);
  return updated.rows.length === 1;
}

// Disputed reservations are only resolved with a real amount (reconciliation or operator), never released. The amount
// needs a source (e.g. the provider's usage or invoice reference) and an actor; both are written to the task's event log in
// the same transaction, so every resolution – also one with 0 – can be traced to its evidence.
export type DisputeResolution = { settledAmountCents: number; source: string; actor: string };
export async function resolveDispute(db: Database, id: string, resolution: DisputeResolution): Promise<boolean> {
  const source = typeof resolution?.source === "string" ? resolution.source.trim() : "";
  const actor = typeof resolution?.actor === "string" ? resolution.actor.trim() : "";
  if (!cents(resolution?.settledAmountCents) || !source || !actor) return false;
  return db.transaction(async sql => {
    const reservation = (await sql.query("SELECT task_id FROM budget_reservations WHERE id=$1 AND status='disputed'", [id])).rows[0];
    if (!reservation) return false;
    // The task row lock serialises the event sequence, as in the repository.
    await sql.query("SELECT id FROM enterprise_tasks WHERE id=$1 FOR UPDATE", [reservation.task_id]);
    const updated = await sql.query(`UPDATE budget_reservations SET status='settled',settled_amount_cents=$2,settled_at=now()
      WHERE id=$1 AND status='disputed' RETURNING id`, [id, resolution.settledAmountCents]);
    if (updated.rows.length !== 1) return false;
    await sql.query(`INSERT INTO enterprise_task_events(task_id,seq,kind,actor,fencing_token,detail)
      SELECT $1, coalesce(max(seq),0)+1, 'dispute_resolved', $2, NULL, $3::jsonb FROM enterprise_task_events WHERE task_id=$1`,
      [reservation.task_id, actor.slice(0, 100), JSON.stringify({ reservationId: id, settledAmountCents: resolution.settledAmountCents, source: source.slice(0, 500) })]);
    return true;
  });
}

// Used by the repository inside the transaction that records a task result.
// Known usage: the open reservations of the attempt are settled, the whole amount on the oldest one, the rest with 0.
export async function settleTaskReservations(sql: Sql, taskId: string, usedCents: number) {
  const open = (await sql.query("SELECT id FROM budget_reservations WHERE task_id=$1 AND status='reserved' ORDER BY created_at, id", [taskId])).rows;
  for (const [index, row] of open.entries())
    await sql.query("UPDATE budget_reservations SET status='settled',settled_amount_cents=$2,settled_at=now() WHERE id=$1",
      [row.id, index === 0 ? Math.max(0, Math.trunc(usedCents)) : 0]);
  return open.length;
}

// Unknown usage (outcome_unknown, lost worker): open reservations are disputed and keep counting.
export async function disputeTaskReservations(sql: Sql, taskId: string) {
  return (await sql.query("UPDATE budget_reservations SET status='disputed' WHERE task_id=$1 AND status='reserved' RETURNING id", [taskId])).rows.length;
}

export async function committedBudget(db: Database, department: string, period: string): Promise<number> {
  return committed(db, department, period);
}
