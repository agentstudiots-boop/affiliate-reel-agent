// Hard budget guard of the executive kernel (task B-05) on budget_reservations (migration 039).
//
// A paid call may only start after its amount is reserved against the department's monthly limit; afterwards the
// reservation is settled with the real amount. An unclear outcome (outcome_unknown, lost response) disputes the
// reservation: it keeps counting against the budget and is never released automatically. Reservations of one department
// and month are serialised by an advisory lock, as in lib/visual/runway-budget.ts. Limits come from the caller (the
// budgets table follows with E-01); an invalid limit refuses every reservation. No provider calls while the lock is held.
// All times come from the database clock, like in the repository (B-03) – including the budget month, which the caller
// cannot choose. Reserving, settling and releasing are bound to the worker's lease (holder + fencing token) of a running
// task: a worker that lost its lease can neither reserve nor free budget. Disputing only makes the guard stricter and
// resolving a dispute is a reconciliation step outside department code; both work by reservation id.

import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../memory/db";

export type Reservation = { id: string; taskId: string; department: string; period: string; amountCents: number };
export type ReserveResult =
  | { ok: true; reservation: Reservation; committedCents: number; limitCents: number }
  | { ok: false; reason: "budget_exhausted" | "invalid_request" | "task_not_running"; detail: string; committedCents?: number; limitCents?: number };

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

export async function reserveBudget(db: Database, lease: LeaseRef, request: { amountCents: number; limitCents: number }): Promise<ReserveResult> {
  if (!cents(request.amountCents) || request.amountCents === 0) return { ok: false, reason: "invalid_request", detail: "Betrag muss eine positive ganze Zahl in Cent sein" };
  if (!cents(request.limitCents)) return { ok: false, reason: "invalid_request", detail: "Budgetgrenze ungültig" };
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
    const used = await committed(sql, department, period);
    if (used + request.amountCents > request.limitCents)
      return { ok: false as const, reason: "budget_exhausted" as const, detail: `Monatsbudget ${department} ${period} erschöpft`, committedCents: used, limitCents: request.limitCents };
    const id = randomUUID();
    await sql.query(`INSERT INTO budget_reservations(id,task_id,department,period,amount_cents) VALUES($1,$2,$3,$4,$5)`,
      [id, lease.id, department, period, request.amountCents]);
    return { ok: true as const, reservation: { id, taskId: lease.id, department, period, amountCents: request.amountCents },
      committedCents: used + request.amountCents, limitCents: request.limitCents };
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

// Disputed reservations are only resolved with a real amount (reconciliation or operator), never released.
export async function resolveDispute(db: Database, id: string, settledAmountCents: number): Promise<boolean> {
  if (!cents(settledAmountCents)) return false;
  const updated = await db.query(`UPDATE budget_reservations SET status='settled',settled_amount_cents=$2,settled_at=now()
    WHERE id=$1 AND status='disputed' RETURNING id`, [id, settledAmountCents]);
  return updated.rows.length === 1;
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
