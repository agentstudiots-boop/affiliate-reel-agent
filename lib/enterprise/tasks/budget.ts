// Hard budget guard of the executive kernel (task B-05) on budget_reservations (migration 039).
//
// A paid call may only start after its amount is reserved against the department's monthly limit; afterwards the
// reservation is settled with the real amount. An unclear outcome (outcome_unknown, lost response) disputes the
// reservation: it keeps counting against the budget and is never released automatically. Reservations of one department
// and month are serialised by an advisory lock, as in lib/visual/runway-budget.ts. Limits come from the caller (the
// budgets table follows with E-01); an invalid limit refuses every reservation. No provider calls while the lock is held.
// All times come from the database clock, like in the repository (B-03).

import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../memory/db";

export type Reservation = { id: string; taskId: string; department: string; period: string; amountCents: number };
export type ReserveResult =
  | { ok: true; reservation: Reservation; committedCents: number; limitCents: number }
  | { ok: false; reason: "budget_exhausted" | "invalid_request" | "task_not_running"; detail: string; committedCents?: number; limitCents?: number };

const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const cents = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// Budget month in the operator's time zone (Europe/Berlin), e.g. "2026-11".
export function periodOf(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).formatToParts(date);
  return `${parts.find(part => part.type === "year")?.value}-${parts.find(part => part.type === "month")?.value}`;
}

// Everything that still counts against the limit: open and disputed reservations at their reserved amount, settled ones
// at their real amount (which may exceed the reservation). Released reservations no longer count.
async function committed(sql: Sql, department: string, period: string) {
  const row = (await sql.query(`SELECT coalesce(sum(CASE WHEN status IN ('reserved','disputed') THEN amount_cents
      WHEN status='settled' THEN settled_amount_cents ELSE 0 END),0)::bigint AS cents
    FROM budget_reservations WHERE department=$1 AND period=$2`, [department, period])).rows[0];
  return Number(row?.cents ?? 0);
}

export async function reserveBudget(db: Database, request: { taskId: string; amountCents: number; limitCents: number; period: string }): Promise<ReserveResult> {
  if (!cents(request.amountCents) || request.amountCents === 0) return { ok: false, reason: "invalid_request", detail: "Betrag muss eine positive ganze Zahl in Cent sein" };
  if (!cents(request.limitCents)) return { ok: false, reason: "invalid_request", detail: "Budgetgrenze ungültig" };
  if (!PERIOD.test(request.period)) return { ok: false, reason: "invalid_request", detail: "Periode muss YYYY-MM sein" };
  return db.transaction(async sql => {
    // Only a task that is actually being worked on may reserve; its department is taken from the ledger, not the caller.
    const task = (await sql.query("SELECT department,max_cost_cents FROM enterprise_tasks WHERE id=$1 AND status IN ('leased','running') AND lease_until > now() FOR UPDATE", [request.taskId])).rows[0];
    if (!task) return { ok: false as const, reason: "task_not_running" as const, detail: "Aufgabe nicht in Bearbeitung" };
    const department = String(task.department);
    const already = (await sql.query("SELECT coalesce(sum(amount_cents),0)::bigint AS cents FROM budget_reservations WHERE task_id=$1 AND status<>'released'", [request.taskId])).rows[0];
    if (Number(already?.cents ?? 0) + request.amountCents > Number(task.max_cost_cents))
      return { ok: false as const, reason: "budget_exhausted" as const, detail: `Aufgabenbudget ${task.max_cost_cents} Cent überschritten` };
    await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`enterprise-budget:${department}:${request.period}`]);
    const used = await committed(sql, department, request.period);
    if (used + request.amountCents > request.limitCents)
      return { ok: false as const, reason: "budget_exhausted" as const, detail: `Monatsbudget ${department} ${request.period} erschöpft`, committedCents: used, limitCents: request.limitCents };
    const id = randomUUID();
    await sql.query(`INSERT INTO budget_reservations(id,task_id,department,period,amount_cents) VALUES($1,$2,$3,$4,$5)`,
      [id, request.taskId, department, request.period, request.amountCents]);
    return { ok: true as const, reservation: { id, taskId: request.taskId, department, period: request.period, amountCents: request.amountCents },
      committedCents: used + request.amountCents, limitCents: request.limitCents };
  });
}

// The call happened and its real cost is known.
export async function settleReservation(db: Database, id: string, settledAmountCents: number): Promise<boolean> {
  if (!cents(settledAmountCents)) return false;
  const updated = await db.query(`UPDATE budget_reservations SET status='settled',settled_amount_cents=$2,settled_at=now()
    WHERE id=$1 AND status='reserved' RETURNING id`, [id, settledAmountCents]);
  return updated.rows.length === 1;
}

// The call certainly did not happen (e.g. refused before sending). Never for an unclear outcome: a task in
// outcome_unknown keeps its reservations; use disputeReservation instead.
export async function releaseReservation(db: Database, id: string): Promise<boolean> {
  const updated = await db.query(`UPDATE budget_reservations r SET status='released',settled_at=now()
    WHERE r.id=$1 AND r.status='reserved'
      AND NOT EXISTS (SELECT 1 FROM enterprise_tasks t WHERE t.id=r.task_id AND t.status='outcome_unknown') RETURNING r.id`, [id]);
  return updated.rows.length === 1;
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
