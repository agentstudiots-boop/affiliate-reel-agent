// One controlling run (cron /api/cron/controlling-import): imports new model_calls into the cost ledger and applies prices
// entered since. The cursor is the ledger itself – the highest model_calls id already booked – so no extra state table is
// needed and a run after an outage simply continues. Calls without any reported unit produce no line and are re-read at the
// start of the next run; with MAX_BATCHES × 1000 calls per run this never stalls in practice. Concurrent runs skip (lock in
// import-model-calls.ts); nothing here talks to a provider or prices anything by assumption.

import type { Database } from "../../memory/db";
import { departmentForAgent } from "./agent-departments";
import { importModelCalls, repriceModelCallEntries } from "./import-model-calls";

const MAX_BATCHES = 20;

export type ControllingRun = { status: "ok" | "skipped"; batches: number; calls: number; inserted: number; priced: number; unpriced: number;
  repriced: number; cursorFrom: number; cursorTo: number | null };

export async function ledgerCursor(db: Database): Promise<number> {
  const row = (await db.query(`SELECT max((substring(source_ref from '^model_calls:([0-9]+):'))::bigint) AS id
    FROM cost_entries WHERE source='model_calls'`)).rows[0];
  return row?.id === null || row?.id === undefined ? 0 : Number(row.id);
}

export async function runControllingImport(db: Database, options: { maxBatches?: number; batchSize?: number } = {}): Promise<ControllingRun> {
  const cursorFrom = await ledgerCursor(db);
  const run: ControllingRun = { status: "ok", batches: 0, calls: 0, inserted: 0, priced: 0, unpriced: 0, repriced: 0, cursorFrom, cursorTo: null };
  let afterId = cursorFrom;
  for (let batch = 0; batch < Math.min(options.maxBatches ?? MAX_BATCHES, MAX_BATCHES); batch++) {
    const result = await importModelCalls(db, { afterId, limit: options.batchSize, departmentOf: departmentForAgent, exclusive: true });
    if (result.skipped) return { ...run, status: "skipped" };
    run.batches++; run.calls += result.calls; run.inserted += result.inserted; run.priced += result.priced; run.unpriced += result.unpriced;
    if (result.lastCallId === null) break;
    afterId = run.cursorTo = result.lastCallId;
    if (result.calls < (options.batchSize ?? 1000)) break;
  }
  const repriced = await repriceModelCallEntries(db, { exclusive: true });
  if (repriced.skipped) return { ...run, status: "skipped" };
  run.repriced = repriced.repriced;
  return run;
}
