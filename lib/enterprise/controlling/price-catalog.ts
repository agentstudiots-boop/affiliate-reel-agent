// Price catalogue maintenance (task E-02) on table price_catalog of migration 040. Not wired into the app.
//
// The operator enters prices by hand from the provider's public price page; nothing is fetched or assumed. A price is parsed
// exactly from its text (decimal comma, up to 6 decimals = micro currency units per unit) or rejected with a reason. Validity
// is given in Berlin calendar days (valid_from inclusive, valid_to exclusive). Entering the same price again changes nothing;
// the same provider, item, unit and start with different content is rejected, never overwritten, and nothing is deleted.
// Overlapping prices of one unit are allowed – readers take the newest started valid_from (rule of 040, same selection as the
// importer E-03). Two guards keep already computed costs consistent:
// * one pricing basis per provider and item at a time (tokens or seconds or another unit), so a call is never charged twice;
// * no price that would retroactively supersede a price already used for imported cost lines, and no end before such a use.
// A price in another currency than EUR is stored but counts as unknown in the ControllingSnapshot (E-07).

import { randomUUID } from "node:crypto";
import type { Database, Sql } from "../../memory/db";
import { parseDay, parseDecimal } from "./manual-entries";

export const PRICE_UNITS = ["input_token", "output_token", "second", "image", "video_second", "request", "month"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

export type NewPrice = {
  provider: string; item: string; unit: string;
  price: string;               // per unit, decimal comma, up to 6 decimals ("0,000002")
  currency?: string;           // ISO code, default EUR
  validFrom: string; validTo?: string | null; // Berlin days, "JJJJ-MM-TT" or "TT.MM.JJJJ"; validTo exclusive
  sourceUrl: string; enteredBy: string;
};
export type PriceResult = { status: "recorded" | "duplicate"; id: string } | { status: "rejected"; reason: string };
export type CatalogPrice = {
  id: string; provider: string; item: string; unit: PriceUnit; priceMicros: number; currency: string;
  validFrom: string; validTo: string | null; sourceUrl: string; enteredBy: string;
};

const PROVIDER = /^[a-z0-9][a-z0-9_.-]{0,59}$/;
const CURRENCY = /^[A-Z]{3}$/;
const rejected = (reason: string): { status: "rejected"; reason: string } => ({ status: "rejected", reason });
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;
const isUnit = (value: unknown): value is PriceUnit => typeof value === "string" && (PRICE_UNITS as readonly string[]).includes(value);
// Input and output tokens together form one basis; every other unit is a basis of its own.
const basisOf = (unit: string) => unit === "input_token" || unit === "output_token" ? "token" : unit;
const BERLIN_DAY = (param: string) => `((${param}::date)::timestamp AT TIME ZONE 'Europe/Berlin')`;
const lock = (sql: Sql, provider: string, item: string) => sql.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`price-catalog:${provider}:${item}`]);

function httpsUrl(value: unknown): string | null {
  const url = text(value, 2000);
  if (!url) return null;
  // Literal lowercase scheme as required by the CHECK of 040 ("HTTPS://" would pass URL parsing but fail the insert).
  if (!url.startsWith("https://")) return null;
  try { return new URL(url).protocol === "https:" ? url : null; } catch { return null; }
}

export async function addPrice(db: Database, input: NewPrice): Promise<PriceResult> {
  const provider = typeof input.provider === "string" ? input.provider.trim() : "";
  if (!PROVIDER.test(provider)) return rejected("Anbieter ungültig (Kleinbuchstaben, Ziffern, _ . -)");
  const item = text(input.item, 120);
  if (!item) return rejected("Artikel/Modell fehlt");
  if (!isUnit(input.unit)) return rejected(`Einheit ungültig (${PRICE_UNITS.join(", ")})`);
  const unit = input.unit;
  const micros = parseDecimal(input.price, 6, false);
  if (micros === null) return rejected("Preis ungültig (Dezimalkomma, höchstens 6 Nachkommastellen, nicht negativ)");
  const currency = input.currency ?? "EUR";
  if (typeof currency !== "string" || !CURRENCY.test(currency)) return rejected("Währung ungültig (ISO-Code, z. B. EUR)");
  const from = parseDay(input.validFrom);
  if (!from) return rejected("Gültig ab ungültig (JJJJ-MM-TT oder TT.MM.JJJJ)");
  const to = input.validTo === null || input.validTo === undefined ? null : parseDay(input.validTo);
  if (input.validTo !== null && input.validTo !== undefined && !to) return rejected("Gültig bis ungültig (JJJJ-MM-TT oder TT.MM.JJJJ)");
  if (to && to <= from) return rejected("Gültig bis muss nach Gültig ab liegen");
  const sourceUrl = httpsUrl(input.sourceUrl);
  if (!sourceUrl) return rejected("Quelle fehlt oder ist keine https-Adresse");
  const enteredBy = text(input.enteredBy, 100);
  if (!enteredBy) return rejected("Erfasst von fehlt");

  return db.transaction(async sql => {
    await lock(sql, provider, item);
    // Same key: identical content (apart from who entered it) is a duplicate, anything else a conflict.
    const existing = (await sql.query(`SELECT id, price_micros, currency, valid_to = ${BERLIN_DAY("$5")} AS same_to, valid_to IS NULL AS open, source_url
      FROM price_catalog WHERE provider=$1 AND item=$2 AND unit=$3 AND valid_from = ${BERLIN_DAY("$4")}`, [provider, item, unit, from, to])).rows[0];
    if (existing) {
      const same = Number(existing.price_micros) === micros && existing.currency === currency && existing.source_url === sourceUrl
        && (to === null ? existing.open === true : existing.same_to === true);
      return same ? { status: "duplicate", id: String(existing.id) } : rejected("Preis mit diesem Beginn bereits mit anderem Inhalt erfasst – nicht überschrieben");
    }
    // One basis per provider and item: a price of another basis must not be valid at the same time.
    const overlapping = (await sql.query(`SELECT DISTINCT unit FROM price_catalog WHERE provider=$1 AND item=$2
      AND (valid_to IS NULL OR valid_to > ${BERLIN_DAY("$3")}) AND ($4::date IS NULL OR valid_from < ${BERLIN_DAY("$4")})`, [provider, item, from, to])).rows;
    const other = overlapping.map(row => String(row.unit)).filter(existingUnit => basisOf(existingUnit) !== basisOf(unit));
    if (other.length) return rejected(`im selben Zeitraum bereits auf anderer Basis bepreist (${other.sort().join(", ")}) – erst beenden`);
    // A newer start would supersede the price already used for imported costs in this period; those amounts stay as they are.
    const used = (await sql.query(`SELECT 1 FROM cost_entries c JOIN price_catalog p ON p.id = c.price_catalog_id
      WHERE c.provider=$1 AND c.item=$2 AND c.unit=$3 AND c.occurred_at >= ${BERLIN_DAY("$4")} AND ($5::date IS NULL OR c.occurred_at < ${BERLIN_DAY("$5")})
        AND p.valid_from < ${BERLIN_DAY("$4")} LIMIT 1`, [provider, item, unit, from, to])).rows;
    if (used.length) return rejected("für diesen Zeitraum wurden bereits Kosten mit einem älteren Preis berechnet – rückwirkend nicht zulässig");
    const id = randomUUID();
    await sql.query(`INSERT INTO price_catalog(id,provider,item,unit,price_micros,currency,valid_from,valid_to,source_url,entered_by)
      VALUES($1,$2,$3,$4,$5,$6,${BERLIN_DAY("$7")},CASE WHEN $8::date IS NULL THEN NULL ELSE ${BERLIN_DAY("$8")} END,$9,$10)`,
      [id, provider, item, unit, micros, currency, from, to, sourceUrl, enteredBy]);
    return { status: "recorded", id };
  });
}

// Sets the missing end of a price (exclusive Berlin day). An existing end is never changed and nothing is deleted.
export async function endPrice(db: Database, id: string, validTo: string): Promise<PriceResult> {
  const to = parseDay(validTo);
  if (!to) return rejected("Gültig bis ungültig (JJJJ-MM-TT oder TT.MM.JJJJ)");
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return rejected("Preis nicht gefunden");
  return db.transaction(async sql => {
    const row = (await sql.query(`SELECT provider, item, valid_to IS NULL AS open, valid_from < ${BERLIN_DAY("$2")} AS before_end
      FROM price_catalog WHERE id=$1`, [id, to])).rows[0];
    if (!row) return rejected("Preis nicht gefunden");
    await lock(sql, String(row.provider), String(row.item));
    if (row.open !== true) return rejected("Preis hat bereits ein Ende – nicht geändert");
    if (row.before_end !== true) return rejected("Gültig bis muss nach Gültig ab liegen");
    const used = (await sql.query(`SELECT 1 FROM cost_entries WHERE price_catalog_id=$1 AND occurred_at >= ${BERLIN_DAY("$2")} LIMIT 1`, [id, to])).rows;
    if (used.length) return rejected("Preis wurde für Kosten nach diesem Ende bereits verwendet – nicht geändert");
    const updated = await sql.query(`UPDATE price_catalog SET valid_to = ${BERLIN_DAY("$2")} WHERE id=$1 AND valid_to IS NULL RETURNING id`, [id, to]);
    return updated.rows.length ? { status: "recorded", id } : rejected("Preis hat bereits ein Ende – nicht geändert");
  });
}

// Read only. Without `at` every entry; with `at` (ISO timestamp) the price per provider, item and unit valid at that moment,
// selected like the importer: the newest valid_from that has started and not ended.
export async function listPrices(db: Database, filter: { provider?: string; at?: string } = {}): Promise<CatalogPrice[]> {
  const provider = filter.provider === undefined ? null : String(filter.provider);
  const at = filter.at === undefined ? null : new Date(filter.at);
  if (at && Number.isNaN(at.getTime())) throw new Error("listPrices: at ist kein gültiger Zeitpunkt");
  const rows = (await db.query(`SELECT ${at ? "DISTINCT ON (provider, item, unit)" : ""} id, provider, item, unit, price_micros, currency,
      valid_from, valid_to, source_url, entered_by FROM price_catalog
    WHERE ($1::text IS NULL OR provider = $1)
      AND ($2::timestamptz IS NULL OR (valid_from <= $2::timestamptz AND (valid_to IS NULL OR valid_to > $2::timestamptz)))
    ORDER BY provider, item, unit, valid_from DESC`, [provider, at ? at.toISOString() : null])).rows;
  return rows.map(row => ({
    id: String(row.id), provider: String(row.provider), item: String(row.item), unit: row.unit as PriceUnit,
    priceMicros: Number(row.price_micros), currency: String(row.currency),
    validFrom: new Date(row.valid_from as Date | string).toISOString(), validTo: row.valid_to === null ? null : new Date(row.valid_to as Date | string).toISOString(),
    sourceUrl: String(row.source_url), enteredBy: String(row.entered_by),
  }));
}
