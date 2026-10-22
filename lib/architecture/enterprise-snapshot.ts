import { getDatabase, type Database, type Sql } from "../memory/db";
import { checkHealth, type DepartmentContext, type DepartmentModule, type HealthReport } from "../enterprise/contract";
import { readControllingSnapshot } from "../enterprise/controlling/snapshot";
import { affiliateContext, affiliateDepartment } from "../enterprise/departments/affiliate";
import type { DepartmentId } from "../enterprise/registry";
import { buildEnterpriseView, type DecisionCountRow, type EnterpriseView, type TaskCountRow } from "./enterprise";

// Read-only evidence for the enterprise level of the Command Center (task H-01). Same rules as snapshot.ts: SELECT only,
// every part in its own READ ONLY transaction, a missing table (migration 039/040/041 not applied yet) leaves only that part
// empty, and in preview/development the runtime guard refuses the database handle – the view then says so.

export type ConnectedDepartment = { module: DepartmentModule; context: (db: Database, now: Date) => DepartmentContext };
// Departments with a runtime module behind the contract. Only the affiliate adapter (G-01) exists so far; it reads in READ ONLY
// transactions itself and never writes.
export const CONNECTED_DEPARTMENTS: Partial<Record<DepartmentId, ConnectedDepartment>> = {
  affiliate: { module: affiliateDepartment, context: (db, now) => affiliateContext(db, () => now) },
};

const at = (value: unknown) => value ? new Date(String(value)).toISOString() : null;

async function readOnly<T>(db: Database, work: (sql: Sql) => Promise<T>): Promise<T | null> {
  try { return await db.transaction(async sql => { await sql.query("SET TRANSACTION READ ONLY"); return work(sql); }); }
  catch { return null; }
}
async function exists(sql: Sql, table: string) {
  return (await sql.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`public.${table}`])).rows[0]?.ok === true;
}

async function healthOf(id: DepartmentId, connected: ConnectedDepartment, db: Database, now: Date): Promise<HealthReport | null> {
  try {
    const checked = checkHealth(await connected.module.health(connected.context(db, now)), id);
    return checked.ok ? checked.report : null;
  } catch { return null; }
}

// Never throws: an unexpected error leaves the whole enterprise level without values instead of breaking the Command Center.
export async function readEnterpriseView(now = new Date(), open: () => Database = getDatabase,
  connected: Partial<Record<DepartmentId, ConnectedDepartment>> = CONNECTED_DEPARTMENTS): Promise<EnterpriseView> {
  try { return await collect(now, open, connected); }
  catch {
    return buildEnterpriseView({ now, health: null, tasks: null, decisions: null, controlling: null, unavailableReason: "Unternehmensebene nicht lesbar (unerwarteter Fehler)" });
  }
}

async function collect(now: Date, open: () => Database, connected: Partial<Record<DepartmentId, ConnectedDepartment>>): Promise<EnterpriseView> {
  let db: Database;
  try { db = open(); }
  catch (error) {
    const blocked = error instanceof Error && /non_production_effect_blocked/.test(error.message);
    return buildEnterpriseView({ now, health: null, tasks: null, decisions: null, controlling: null,
      unavailableReason: blocked ? "Preview/Entwicklung: Datenbankzugriff durch den Runtime-Guard gesperrt" : "Keine Datenbank erreichbar oder nicht konfiguriert" });
  }
  const health: Partial<Record<DepartmentId, HealthReport | null>> = {};
  for (const [id, entry] of Object.entries(connected) as [DepartmentId, ConnectedDepartment][]) health[id] = await healthOf(id, entry, db, now);

  const tasks = await readOnly(db, async sql => {
    if (!await exists(sql, "enterprise_tasks")) return null;
    return (await sql.query("SELECT department, status, count(*)::int AS n, max(updated_at) AS last_at FROM enterprise_tasks GROUP BY department, status")).rows
      .map((row): TaskCountRow => ({ department: String(row.department), status: String(row.status), count: Number(row.n), lastAt: at(row.last_at) }));
  });
  // Pending requests past their expiry are left out: expireDecisions (B-06) marks them expired, never approved.
  const decisions = await readOnly(db, async sql => {
    if (!await exists(sql, "enterprise_decisions")) return null;
    return (await sql.query(`SELECT department, count(*)::int AS n, min(expires_at) AS next_expiry FROM enterprise_decisions
        WHERE status = 'pending' AND expires_at > $1::timestamptz GROUP BY department`, [now.toISOString()])).rows
      .map((row): DecisionCountRow => ({ department: String(row.department), pending: Number(row.n), nextExpiry: at(row.next_expiry) }));
  });
  const controlling = await readControllingSnapshot(db, now).catch(() => null);
  return buildEnterpriseView({ now, health, tasks, decisions, controlling });
}
