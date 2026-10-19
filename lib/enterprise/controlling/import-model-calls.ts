// Importer model_calls → cost_entries (task E-03) on the ledger of migration 040.
//
// Each model call becomes up to three measured cost lines (input tokens, output tokens, provider compute seconds), one per
// unit that the provider actually reported. An amount is only computed when the price catalogue holds a price for this
// provider, model and unit that was valid at the time of the call; otherwise the amount stays NULL ("unbekannt") – no
// price is ever assumed. Lines are keyed by (source, source_ref), so running the import again changes nothing and a call
// is never counted twice. The department is supplied by the caller (e.g. the register mapping of E-06); without it the
// line stays unassigned. Reads model_calls, writes only cost_entries; not wired into the app.

import { randomUUID } from "node:crypto";
import type { Database } from "../../memory/db";

export type DepartmentOf = (agent: string) => string | null;
export type ImportResult = { calls: number; inserted: number; priced: number; unpriced: number; lastCallId: number | null };

const UNITS = [
  { unit: "input_token", column: "input_tokens" },
  { unit: "output_token", column: "output_tokens" },
  { unit: "second", column: "predict_time_s" },
] as const;
const MAX_BATCH = 1000;
const DEPARTMENT = /^[a-z][a-z_]{1,39}$/;

// Cents from a quantity and a price in micro currency units per unit, rounded half up; null if not representable.
export function amountCents(quantity: number, priceMicros: number): number | null {
  if (!(quantity >= 0) || !(priceMicros >= 0) || !Number.isFinite(quantity) || !Number.isFinite(priceMicros)) return null;
  const cents = Math.round((quantity * priceMicros) / 10_000);
  return Number.isSafeInteger(cents) ? cents : null;
}

// Imports calls with id > afterId (oldest first, at most `limit`). The caller keeps the returned lastCallId as cursor;
// re-importing an id range is harmless because existing lines are skipped.
export async function importModelCalls(db: Database, options: { afterId?: number; limit?: number; departmentOf?: DepartmentOf } = {}): Promise<ImportResult> {
  const afterId = Number.isSafeInteger(options.afterId) && (options.afterId ?? 0) >= 0 ? options.afterId! : 0;
  const limit = Math.min(Math.max(Number.isSafeInteger(options.limit) ? options.limit! : MAX_BATCH, 1), MAX_BATCH);
  return db.transaction(async sql => {
    const calls = (await sql.query(`SELECT id, agent, model, provider, input_tokens, output_tokens, predict_time_s, created_at
      FROM model_calls WHERE id > $1 ORDER BY id LIMIT $2`, [afterId, limit])).rows;
    const result: ImportResult = { calls: calls.length, inserted: 0, priced: 0, unpriced: 0, lastCallId: null };
    for (const call of calls) {
      result.lastCallId = Number(call.id);
      const agent = String(call.agent);
      const mapped = options.departmentOf?.(agent) ?? null;
      const department = mapped && DEPARTMENT.test(mapped) ? mapped : null;
      for (const { unit, column } of UNITS) {
        if (call[column] === null || call[column] === undefined) continue;
        const quantity = Number(call[column]);
        if (!Number.isFinite(quantity) || quantity < 0) continue;
        const price = (await sql.query(`SELECT id, price_micros, currency FROM price_catalog
          WHERE provider=$1 AND item=$2 AND unit=$3 AND valid_from <= $4::timestamptz AND (valid_to IS NULL OR valid_to > $4::timestamptz)
          ORDER BY valid_from DESC LIMIT 1`, [String(call.provider), String(call.model), unit, call.created_at])).rows[0];
        const amount = price ? amountCents(quantity, Number(price.price_micros)) : null;
        const inserted = await sql.query(`INSERT INTO cost_entries(id,occurred_at,department,agent,provider,category,quantity,unit,amount_cents,currency,
            value_kind,source,source_ref,price_catalog_id)
          VALUES($1,$2::timestamptz,$3,$4,$5,'model',$6,$7,$8,$9,'measured','model_calls',$10,$11)
          ON CONFLICT (source, source_ref) DO NOTHING RETURNING id`,
          [randomUUID(), call.created_at, department, agent, String(call.provider), quantity, unit, amount,
            price ? String(price.currency) : "EUR", `model_calls:${call.id}:${unit}`, amount === null ? null : price.id]);
        if (inserted.rows.length) {
          result.inserted++;
          if (amount === null) result.unpriced++; else result.priced++;
        }
      }
    }
    return result;
  });
}
