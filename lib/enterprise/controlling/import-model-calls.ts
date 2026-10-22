// Importer model_calls → cost_entries (task E-03) on the ledger of migration 040.
//
// Each model call becomes up to three measured cost lines (input tokens, output tokens, provider compute seconds), one per
// unit that the provider actually reported. An amount is only computed when the price catalogue holds a price for this
// provider, model and unit that was valid at the time of the call; otherwise the amount and its currency stay NULL
// ("unbekannt") – no price is ever assumed. Amounts are exact micro currency units per line (a call usually costs less
// than a cent); cents only appear in sums (E-07). Lines are keyed by (source, source_ref), so running the import again
// changes nothing and a call is never counted twice; a price entered later is applied by repriceModelCallEntries, which
// only fills lines whose amount is still unknown. Calls younger than a minute are left for the next run, so a call whose
// insert committed late (lower id, parallel instances) is not skipped by the cursor. The department is supplied by the
// caller (e.g. the register mapping of E-06); without it the line stays unassigned. Reads model_calls and price_catalog,
// writes only cost_entries; not wired into the app.

import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../memory/db";

export type DepartmentOf = (agent: string) => string | null;
export type ImportResult = { calls: number; inserted: number; priced: number; unpriced: number; lastCallId: number | null };

const UNITS = [
  { unit: "input_token", column: "input_tokens" },
  { unit: "output_token", column: "output_tokens" },
  { unit: "second", column: "predict_time_s" },
] as const;
const MAX_BATCH = 1000;
const DEPARTMENT = /^[a-z][a-z_]{1,39}$/;

// Micro currency units from a quantity and a price in micro units per unit, rounded half up (only fractional quantities such
// as seconds round at all); null if not representable.
export function amountMicros(quantity: number, priceMicros: number): number | null {
  if (!(quantity >= 0) || !(priceMicros >= 0) || !Number.isFinite(quantity) || !Number.isFinite(priceMicros)) return null;
  const micros = Math.round(quantity * priceMicros);
  return Number.isSafeInteger(micros) ? micros : null;
}

// The catalogue price valid at a point in time: the newest valid_from that has started and not ended (overlaps allowed).
const PRICE_AT = `SELECT id, price_micros, currency FROM price_catalog
  WHERE provider=$1 AND item=$2 AND unit=$3 AND valid_from <= $4::timestamptz AND (valid_to IS NULL OR valid_to > $4::timestamptz)
  ORDER BY valid_from DESC LIMIT 1`;

// Same advisory lock as the price catalogue maintenance (E-02, the catalogue module next to this file – not named by path,
// its isolation test counts every mention as a use): a price that is being added or ended for a provider and model cannot
// be read half-way by an import (security review J-02 / review #108).
// All locks of a batch are taken up front in a fixed order, so two imports can never wait on each other in a cycle.
export const priceCatalogLockKey = (provider: string, item: string) => `price-catalog:${provider}:${item}`;
async function lockPrices(sql: Sql, pairs: Iterable<[string, string]>) {
  const keys = [...new Set([...pairs].map(([provider, item]) => priceCatalogLockKey(provider, item)))].sort();
  for (const key of keys) await sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
}

// Imports calls with id > afterId (oldest first, at most `limit`). The caller keeps the returned lastCallId as cursor;
// re-importing an id range is harmless because existing lines are skipped.
export async function importModelCalls(db: Database, options: { afterId?: number; limit?: number; departmentOf?: DepartmentOf } = {}): Promise<ImportResult> {
  const afterId = Number.isSafeInteger(options.afterId) && (options.afterId ?? 0) >= 0 ? options.afterId! : 0;
  const limit = Math.min(Math.max(Number.isSafeInteger(options.limit) ? options.limit! : MAX_BATCH, 1), MAX_BATCH);
  return db.transaction(async sql => {
    const calls = (await sql.query(`SELECT id, agent, model, provider, input_tokens, output_tokens, predict_time_s, created_at
      FROM model_calls WHERE id > $1 AND created_at < now() - interval '1 minute' ORDER BY id LIMIT $2`, [afterId, limit])).rows;
    const result: ImportResult = { calls: calls.length, inserted: 0, priced: 0, unpriced: 0, lastCallId: null };
    await lockPrices(sql, calls.map(call => [String(call.provider), String(call.model)] as [string, string]));
    for (const call of calls) {
      result.lastCallId = Number(call.id);
      const agent = String(call.agent);
      const mapped = options.departmentOf?.(agent) ?? null;
      const department = mapped && DEPARTMENT.test(mapped) ? mapped : null;
      for (const { unit, column } of UNITS) {
        if (call[column] === null || call[column] === undefined) continue;
        const quantity = Number(call[column]);
        if (!Number.isFinite(quantity) || quantity < 0) continue;
        const price = (await sql.query(PRICE_AT, [String(call.provider), String(call.model), unit, call.created_at])).rows[0];
        const amount = price ? amountMicros(quantity, Number(price.price_micros)) : null;
        const inserted = await sql.query(`INSERT INTO cost_entries(id,occurred_at,department,agent,provider,item,category,quantity,unit,amount_micros,currency,
            value_kind,source,source_ref,price_catalog_id)
          VALUES($1,$2::timestamptz,$3,$4,$5,$6,'model',$7,$8,$9,$10,'measured','model_calls',$11,$12)
          ON CONFLICT (source, source_ref) DO NOTHING RETURNING id`,
          [randomUUID(), call.created_at, department, agent, String(call.provider), String(call.model), quantity, unit, amount,
            amount === null ? null : String(price.currency), `model_calls:${call.id}:${unit}`, amount === null ? null : price.id]);
        if (inserted.rows.length) {
          result.inserted++;
          if (amount === null) result.unpriced++; else result.priced++;
        }
      }
    }
    return result;
  });
}

// Applies prices entered after the import to model_calls lines whose amount is still unknown (oldest first, at most
// `limit`). A known amount is never changed. Returns how many lines got an amount.
export async function repriceModelCallEntries(db: Database, options: { limit?: number } = {}): Promise<{ checked: number; repriced: number }> {
  const limit = Math.min(Math.max(Number.isSafeInteger(options.limit) ? options.limit! : MAX_BATCH, 1), MAX_BATCH);
  return db.transaction(async sql => {
    // Only lines for which a price now exists: lines that can never be priced must not block the batch forever.
    const open = (await sql.query(`SELECT c.id, c.provider, c.item, c.unit, c.quantity::float8 AS quantity, c.occurred_at FROM cost_entries c
      WHERE c.source='model_calls' AND c.amount_micros IS NULL AND c.item IS NOT NULL
        AND EXISTS (SELECT 1 FROM price_catalog p WHERE p.provider=c.provider AND p.item=c.item AND p.unit=c.unit
          AND p.valid_from <= c.occurred_at AND (p.valid_to IS NULL OR p.valid_to > c.occurred_at))
      ORDER BY c.occurred_at, c.id LIMIT $1 FOR UPDATE`, [limit])).rows;
    let repriced = 0;
    await lockPrices(sql, open.map(line => [String(line.provider), String(line.item)] as [string, string]));
    for (const line of open) {
      const price = (await sql.query(PRICE_AT, [String(line.provider), String(line.item), String(line.unit), line.occurred_at])).rows[0];
      const amount = price ? amountMicros(Number(line.quantity), Number(price.price_micros)) : null;
      if (amount === null) continue;
      const updated = await sql.query(`UPDATE cost_entries SET amount_micros=$2, currency=$3, price_catalog_id=$4
        WHERE id=$1 AND amount_micros IS NULL RETURNING id`, [line.id, amount, String(price.currency), price.id]);
      repriced += updated.rows.length;
    }
    return { checked: open.length, repriced };
  });
}
