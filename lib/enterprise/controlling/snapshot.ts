// ControllingSnapshot (task E-07): the read-only data contract of the controlling department for one Berlin month.
//
// No number without a source and no invented zero: every sum says where it comes from and whether it is complete. Amounts
// that are unknown (cost lines without a catalogue price, revenue not yet reported) are counted as such instead of being
// added as 0; a table that does not exist yet makes its part "unavailable". Model usage comes from model_calls and is
// allocated to departments by the reviewed register mapping (E-06). Everything is read in one READ ONLY transaction.
// The 2D operations view and the command center (H) only consume this contract.

import { z } from "zod";
import type { Database, Sql } from "../../memory/db";
import { DEPARTMENT_IDS } from "../registry";
import { allocateModelUsage, type ModelUsageRow } from "./agent-departments";

type ValueKind = "measured" | "estimated" | "forecast";
const cents = z.number().int().refine(Number.isSafeInteger, "außerhalb des sicheren Zahlenbereichs");
const money = z.object({
  amountCents: cents.nullable(),       // sum of known amounts; null if there is no known amount at all
  entries: z.number().int().nonnegative(),
  unknownAmountEntries: z.number().int().nonnegative(),
  complete: z.boolean(),               // false if any entry has no known amount: the sum is then a lower bound
});
const byKind = z.object({ measured: money, estimated: money, forecast: money });
const usage = z.object({ calls: z.number().int().nonnegative(), failures: z.number().int().nonnegative(), inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(), predictTimeS: z.number().nonnegative(), usageComplete: z.boolean(), models: z.array(z.string()) });

export const controllingSnapshotSchema = z.object({
  contractVersion: z.literal(1),
  period: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
  generatedAt: z.string().datetime({ offset: true }),
  parts: z.object({ modelUsage: z.enum(["ok", "unavailable"]), costs: z.enum(["ok", "unavailable"]), revenue: z.enum(["ok", "unavailable"]) }),
  departments: z.array(z.object({
    department: z.enum(DEPARTMENT_IDS),
    modelUsage: usage.nullable(),
    costs: byKind.nullable(),
    revenue: byKind.nullable(),
  })),
  unassigned: z.object({ modelUsage: usage.extend({ agents: z.array(z.string()) }).nullable(), costs: byKind.nullable() }),
  sources: z.array(z.object({ part: z.string(), table: z.string() })),
});
export type ControllingSnapshot = z.infer<typeof controllingSnapshotSchema>;

// Calendar month in Europe/Berlin as [start, end) timestamps.
export function berlinMonth(date: Date): { period: string; start: string; end: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).formatToParts(date);
  const year = Number(parts.find(part => part.type === "year")?.value), month = Number(parts.find(part => part.type === "month")?.value);
  const pad = (value: number) => String(value).padStart(2, "0");
  const next = month === 12 ? `${year + 1}-01` : `${year}-${pad(month + 1)}`;
  return { period: `${year}-${pad(month)}`, start: `${year}-${pad(month)}-01 00:00:00 Europe/Berlin`, end: `${next}-01 00:00:00 Europe/Berlin` };
}

const emptyMoney = () => ({ amountCents: null as number | null, entries: 0, unknownAmountEntries: 0, complete: true });
const emptyKinds = () => ({ measured: emptyMoney(), estimated: emptyMoney(), forecast: emptyMoney() });

function addMoney(target: ReturnType<typeof emptyMoney>, row: Record<string, unknown>) {
  const entries = Number(row.entries), unknown = Number(row.unknown_amount), known = row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents);
  target.entries += entries;
  target.unknownAmountEntries += unknown;
  if (known !== null) target.amountCents = (target.amountCents ?? 0) + known;
  target.complete = target.unknownAmountEntries === 0;
}

async function tableExists(sql: Sql, table: string) {
  return (await sql.query("SELECT to_regclass($1) IS NOT NULL AS ok", [`public.${table}`])).rows[0]?.ok === true;
}

export async function readControllingSnapshot(db: Database, now: Date = new Date()): Promise<ControllingSnapshot> {
  const month = berlinMonth(now);
  return db.transaction(async sql => {
    await sql.query("SET TRANSACTION READ ONLY");
    const sources: { part: string; table: string }[] = [];
    const departments = Object.fromEntries(DEPARTMENT_IDS.map(id => [id, { department: id, modelUsage: null as z.infer<typeof usage> | null,
      costs: null as ReturnType<typeof emptyKinds> | null, revenue: null as ReturnType<typeof emptyKinds> | null }]));
    const unassigned: ControllingSnapshot["unassigned"] = { modelUsage: null, costs: null };
    const parts: ControllingSnapshot["parts"] = { modelUsage: "unavailable", costs: "unavailable", revenue: "unavailable" };

    if (await tableExists(sql, "model_calls")) {
      // Calls with complete provider metrics and calls with missing metrics are grouped separately: the complete groups carry
      // their sums, an incomplete group marks its department's sums as lower bounds (usageComplete = false).
      const rows = (await sql.query(`SELECT agent, model, (input_tokens IS NULL OR output_tokens IS NULL OR predict_time_s IS NULL) AS incomplete,
          count(*)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS failures,
          coalesce(sum(input_tokens),0)::bigint AS input_tokens, coalesce(sum(output_tokens),0)::bigint AS output_tokens, coalesce(sum(predict_time_s),0)::float8 AS predict_time_s
        FROM model_calls WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz GROUP BY agent, model, 3`, [month.start, month.end])).rows;
      const usageRows: ModelUsageRow[] = rows.map(row => ({ agent: String(row.agent), model: String(row.model), calls: Number(row.calls), failures: Number(row.failures),
        inputTokens: row.incomplete ? null : Number(row.input_tokens), outputTokens: row.incomplete ? null : Number(row.output_tokens),
        predictTimeS: row.incomplete ? null : Number(row.predict_time_s) }));
      const allocation = allocateModelUsage(usageRows);
      for (const id of DEPARTMENT_IDS) departments[id].modelUsage = allocation.byDepartment[id];
      unassigned.modelUsage = allocation.unassigned;
      parts.modelUsage = "ok";
      sources.push({ part: "modelUsage", table: "model_calls" });
    }

    if (await tableExists(sql, "cost_entries")) {
      for (const id of DEPARTMENT_IDS) departments[id].costs = emptyKinds();
      unassigned.costs = emptyKinds();
      const rows = (await sql.query(`SELECT department, value_kind, count(*)::int AS entries, count(*) FILTER (WHERE amount_cents IS NULL)::int AS unknown_amount,
          sum(amount_cents)::bigint AS amount_cents
        FROM cost_entries WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz GROUP BY department, value_kind`, [month.start, month.end])).rows;
      for (const row of rows) {
        const kind = String(row.value_kind) as ValueKind;
        const owner = row.department && Object.prototype.hasOwnProperty.call(departments, String(row.department)) ? departments[String(row.department)].costs : unassigned.costs;
        addMoney(owner![kind], row);
      }
      parts.costs = "ok";
      sources.push({ part: "costs", table: "cost_entries" });
    }

    if (await tableExists(sql, "revenue_entries")) {
      for (const id of DEPARTMENT_IDS) departments[id].revenue = emptyKinds();
      // Revenue rows cover a period; a row counts for the month its period starts in.
      const rows = (await sql.query(`SELECT department, value_kind, count(*)::int AS entries, count(*) FILTER (WHERE amount_cents IS NULL)::int AS unknown_amount,
          sum(amount_cents)::bigint AS amount_cents
        FROM revenue_entries WHERE period_start >= ($1::timestamptz AT TIME ZONE 'Europe/Berlin')::date AND period_start < ($2::timestamptz AT TIME ZONE 'Europe/Berlin')::date
        GROUP BY department, value_kind`, [month.start, month.end])).rows;
      for (const row of rows) {
        const target = departments[String(row.department)]?.revenue;
        if (target) addMoney(target[String(row.value_kind) as ValueKind], row);
      }
      parts.revenue = "ok";
      sources.push({ part: "revenue", table: "revenue_entries" });
    }

    return controllingSnapshotSchema.parse({ contractVersion: 1, period: month.period, generatedAt: now.toISOString(), parts,
      departments: DEPARTMENT_IDS.map(id => departments[id]), unassigned, sources });
  });
}
