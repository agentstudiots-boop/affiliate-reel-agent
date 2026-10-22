// One executive cycle (task B-07): housekeeping, then at most `maxTasks` queued tasks are run through their department
// module. Department modules are passed in; a task whose department has no runtime module fails instead of waiting.
//
// Nothing here decides or approves anything: tasks are L0–L2 by construction (B-01/B-03), decision requests stay requests
// (B-06), and a department result goes through the repository's checks (lease, fencing, budget, outcome_unknown). A
// department that throws has an unknown usage, so its result is recorded as unreadable – the repository fails the task
// and disputes its budget reservations. A department that does not answer within handlerTimeoutMs may still be running and
// acting, so its task ends in outcome_unknown (never retried, reservations disputed), with the task budget given as the upper
// bound of its usage; one hanging task cannot use up the route's time budget for the others.
// The cron route calls this only with EXECUTIVE_ENABLED=true in production.

import type { Database } from "../memory/db";
import type { DepartmentContext, DepartmentModule } from "./contract";
import { expireDecisions } from "./decisions";
import type { DepartmentId } from "./registry";
import { completeTask, leaseNext, reclaimExpired, startTask } from "./tasks/repository";

export type CycleOptions = {
  holder: string;
  leaseMs: number;
  maxTasks: number;
  departments: Partial<Record<DepartmentId, DepartmentModule>>;
  contextFor: (department: DepartmentId) => DepartmentContext;
  // Time per department call; default 15 s, capped by the lease.
  handlerTimeoutMs?: number;
};
export type CycleReport = {
  reclaimed: { requeued: number; dead: number; unknown: number; expired: number };
  expiredDecisions: number;
  ran: { taskId: string; department: string; taskKind: string; outcome: string }[];
};

const MAX_TASKS = 10;
const DEFAULT_HANDLER_TIMEOUT_MS = 15_000;
const TIMED_OUT = Symbol("timed_out");

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<typeof TIMED_OUT>(resolve => { timer = setTimeout(() => resolve(TIMED_OUT), ms); })]); }
  finally { clearTimeout(timer); }
}

export async function runExecutiveCycle(db: Database, options: CycleOptions): Promise<CycleReport> {
  const maxTasks = Math.min(Math.max(Number.isSafeInteger(options.maxTasks) ? options.maxTasks : 1, 0), MAX_TASKS);
  const requested = Number.isFinite(options.handlerTimeoutMs) && (options.handlerTimeoutMs ?? 0) > 0 ? options.handlerTimeoutMs! : DEFAULT_HANDLER_TIMEOUT_MS;
  const handlerTimeoutMs = Math.min(requested, options.leaseMs);
  const reclaimed = await reclaimExpired(db);
  const expiredDecisions = await expireDecisions(db);
  const report: CycleReport = {
    reclaimed: { requeued: reclaimed.requeued.length, dead: reclaimed.dead.length, unknown: reclaimed.unknown.length, expired: reclaimed.expired.length },
    expiredDecisions: expiredDecisions.length,
    ran: [],
  };
  for (let index = 0; index < maxTasks; index++) {
    const lease = await leaseNext(db, options.holder, options.leaseMs);
    if (!lease) break;
    const department = lease.envelope.to;
    const handler = Object.prototype.hasOwnProperty.call(options.departments, department) ? options.departments[department] : undefined;
    let outcome: string;
    if (!handler || handler.id !== department) {
      const done = await completeTask(db, lease, { status: "failed", failureClass: "internal", reason: `Abteilung ${department} hat kein Laufzeitmodul`, usedCostCents: 0, usedModelCalls: 0 });
      outcome = done.ok ? done.outcome : done.reason;
    } else if (!await startTask(db, lease)) {
      outcome = "stale_lease";
    } else {
      let result: unknown;
      try {
        const answer = await withTimeout(Promise.resolve().then(() => handler.handle(lease.envelope, options.contextFor(department))), handlerTimeoutMs);
        result = answer === TIMED_OUT ? { status: "failed", failureClass: "outcome_unknown",
          reason: "Zeitlimit überschritten: Wirkung und Verbrauch unbekannt (Obergrenze: Aufgabenbudget)",
          usedCostCents: lease.envelope.budget.maxCostCents, usedModelCalls: lease.envelope.budget.maxModelCalls } : answer;
      } catch { result = { status: "unreadable" }; }
      const done = await completeTask(db, lease, result);
      outcome = done.ok ? done.outcome : done.reason;
    }
    report.ran.push({ taskId: lease.id, department, taskKind: lease.envelope.taskKind, outcome });
  }
  return report;
}
