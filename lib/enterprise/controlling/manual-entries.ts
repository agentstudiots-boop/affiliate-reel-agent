// Manual cost receipts and revenue (task E-04) on the ledger of migration 040. Not wired into the app.
//
// Costs without an API (subscriptions, hosting, invoices) and revenue that is only available as a report are entered by hand
// or imported from a manually exported file. Nothing is guessed: an amount is parsed exactly from its text (decimal comma,
// EUR only, as in the ControllingSnapshot E-07) or the entry is rejected with a reason. A cost counts as measured only with
// a receipt reference; without one it is an estimate. Every entry carries a reference, so entering or importing it again
// changes nothing (UNIQUE (source, source_ref)); the same reference with different content is a conflict and is rejected,
// never overwritten. Departments come from the executive register only.

import { createHash, randomUUID } from "node:crypto";
import type { Database } from "../../memory/db";
import { DEPARTMENT_IDS, type DepartmentId } from "../registry";

export type EntryResult = { status: "recorded" | "duplicate" } | { status: "rejected"; reason: string };
export type RowResult = { line: number } & EntryResult;

const CATEGORIES = ["model", "media", "research", "infra", "subscription", "other"] as const;
const REVENUE_KINDS = ["measured", "estimated"] as const;
const rejected = (reason: string): EntryResult => ({ status: "rejected", reason });
const isDepartment = (value: unknown): value is DepartmentId => typeof value === "string" && (DEPARTMENT_IDS as readonly string[]).includes(value);
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max ? value.trim() : null;

// "1.234,56", "-12,3", "0,005" (costs only) → exact integer in units of 10^-scale; null if not exactly representable.
// A dot is only accepted as a thousands separator, so "12.50" is rejected instead of being read as 1 250.
export function parseDecimal(value: unknown, scale: 2 | 6, allowNegative: boolean): number | null {
  if (typeof value !== "string") return null;
  const match = /^(-)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/.exec(value.trim());
  if (!match || (match[1] && !allowNegative)) return null;
  const fraction = match[3] ?? "";
  if (fraction.length > scale) return null;
  const units = Number(match[2].replace(/\./g, "") + fraction.padEnd(scale, "0"));
  if (!Number.isSafeInteger(units)) return null;
  return match[1] ? -units || 0 : units;
}

// "2026-10-19" or "19.10.2026" → "2026-10-19" for a real calendar day; otherwise null.
export function parseDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim()), german = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : german ? [german[3], german[2], german[1]] : [];
  if (!year) return null;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}` ? null : `${year}-${month}-${day}`;
}

export type ManualCost = {
  day: string; department: string; category: string; provider: string; item?: string | null;
  quantity?: number; unit?: string;
  amount: string;               // EUR, decimal comma, up to 6 decimals ("12,50")
  receiptRef?: string | null;   // invoice or receipt number ⇒ measured
  entryRef?: string | null;     // own reference for an estimate without receipt
};

export async function recordManualCost(db: Database, cost: ManualCost): Promise<EntryResult> {
  const day = parseDay(cost.day);
  if (!day) return rejected("Datum ungültig (JJJJ-MM-TT oder TT.MM.JJJJ)");
  if (!isDepartment(cost.department)) return rejected("Abteilung nicht im Register");
  if (!(CATEGORIES as readonly string[]).includes(cost.category)) return rejected("Kategorie ungültig");
  const provider = text(cost.provider, 120);
  if (!provider) return rejected("Anbieter fehlt");
  const quantity = cost.quantity ?? 1;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0) return rejected("Menge ungültig");
  const micros = parseDecimal(cost.amount, 6, false);
  if (micros === null) return rejected("Betrag ungültig (EUR, Dezimalkomma, höchstens 6 Nachkommastellen, nicht negativ)");
  const receipt = text(cost.receiptRef, 150), entry = text(cost.entryRef, 150);
  if (!receipt && !entry) return rejected("Belegnummer (gemessen) oder eigene Referenz (Schätzung) fehlt");
  const source = receipt ? "invoice" : "manual";
  const sourceRef = receipt ? `invoice:${receipt}` : `manual:${entry}`;
  const row = { day, department: cost.department, category: cost.category, provider, item: text(cost.item, 120), quantity,
    unit: text(cost.unit, 40) ?? "item", micros, kind: receipt ? "measured" : "estimated" };
  const inserted = await db.query(`INSERT INTO cost_entries(id,occurred_at,department,provider,item,category,quantity,unit,amount_micros,currency,
      value_kind,source,source_ref) VALUES($1,($2::date)::timestamp AT TIME ZONE 'Europe/Berlin',$3,$4,$5,$6,$7,$8,$9,'EUR',$10,$11,$12)
    ON CONFLICT (source, source_ref) DO NOTHING RETURNING id`,
    [randomUUID(), row.day, row.department, row.provider, row.item, row.category, row.quantity, row.unit, row.micros, row.kind, source, sourceRef]);
  if (inserted.rows.length) return { status: "recorded" };
  const existing = (await db.query(`SELECT department, amount_micros, currency, to_char(occurred_at AT TIME ZONE 'Europe/Berlin','YYYY-MM-DD') AS day
    FROM cost_entries WHERE source=$1 AND source_ref=$2`, [source, sourceRef])).rows[0];
  const same = existing && existing.department === row.department && Number(existing.amount_micros) === row.micros && existing.currency === "EUR" && existing.day === row.day;
  return same ? { status: "duplicate" } : rejected("Referenz bereits mit anderem Inhalt erfasst – nicht überschrieben");
}

export type ManualRevenue = {
  periodStart: string; periodEnd: string; department: string; channel: string;
  amount: string;               // EUR, decimal comma, may be negative (returns)
  kind: "measured" | "estimated";
  entryRef: string;
};

type RevenueRow = { periodStart: string; periodEnd: string; department: DepartmentId; channel: string; cents: number; kind: string; source: string; sourceRef: string };

async function insertRevenue(db: Database, row: RevenueRow): Promise<EntryResult> {
  const inserted = await db.query(`INSERT INTO revenue_entries(id,period_start,period_end,department,channel,amount_cents,currency,value_kind,source,source_ref)
    VALUES($1,$2::date,$3::date,$4,$5,$6,'EUR',$7,$8,$9) ON CONFLICT (source, source_ref) DO NOTHING RETURNING id`,
    [randomUUID(), row.periodStart, row.periodEnd, row.department, row.channel, row.cents, row.kind, row.source, row.sourceRef]);
  if (inserted.rows.length) return { status: "recorded" };
  const existing = (await db.query(`SELECT department, amount_cents, currency, to_char(period_start,'YYYY-MM-DD') AS s, to_char(period_end,'YYYY-MM-DD') AS e
    FROM revenue_entries WHERE source=$1 AND source_ref=$2`, [row.source, row.sourceRef])).rows[0];
  const same = existing && existing.department === row.department && Number(existing.amount_cents) === row.cents && existing.currency === "EUR"
    && existing.s === row.periodStart && existing.e === row.periodEnd;
  return same ? { status: "duplicate" } : rejected("Referenz bereits mit anderem Inhalt erfasst – nicht überschrieben");
}

export async function recordManualRevenue(db: Database, revenue: ManualRevenue): Promise<EntryResult> {
  const start = parseDay(revenue.periodStart), end = parseDay(revenue.periodEnd);
  if (!start || !end || end < start) return rejected("Zeitraum ungültig");
  if (!isDepartment(revenue.department)) return rejected("Abteilung nicht im Register");
  const channel = text(revenue.channel, 60);
  if (!channel) return rejected("Kanal fehlt");
  if (!(REVENUE_KINDS as readonly string[]).includes(revenue.kind)) return rejected("Werteart nur measured oder estimated");
  const cents = parseDecimal(revenue.amount, 2, true);
  if (cents === null) return rejected("Betrag ungültig (EUR, Dezimalkomma, höchstens 2 Nachkommastellen)");
  const ref = text(revenue.entryRef, 150);
  if (!ref) return rejected("Referenz fehlt");
  return insertRevenue(db, { periodStart: start, periodEnd: end, department: revenue.department, channel, cents, kind: revenue.kind, source: "manual", sourceRef: `manual:${ref}` });
}

// Column mapping of a manually exported revenue report (e.g. PartnerNet). The operator configures it for the export at hand;
// nothing is assumed about the provider's column names. `key` columns identify a row (e.g. day + tracking ID); `ignore` lists
// columns that are knowingly not used. Any other column makes the whole file fail (fail-closed): a changed export format must
// be looked at, not half-read.
export type RevenueCsvMapping = {
  day: string; amount: string; key: string[];
  currency?: string; channel?: string; ignore?: string[];
  delimiter?: ";" | "," | "\t";
};
export type RevenueCsvRow = { line: number; day: string; cents: number; channel: string | null; key: string };
export type ParsedRevenueCsv = { ok: true; rows: RevenueCsvRow[]; rejected: RowResult[] } | { ok: false; reason: string };

// RFC-4180-style splitting with quotes; one record per physical line (line breaks inside quotes are not supported and fail).
function splitLine(line: string, delimiter: string): string[] | null {
  const cells: string[] = [];
  let cell = "", quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) { cells.push(cell); cell = ""; }
    else cell += char;
  }
  if (quoted) return null;
  cells.push(cell);
  return cells.map(value => value.trim());
}

export function parseRevenueCsv(content: string, mapping: RevenueCsvMapping): ParsedRevenueCsv {
  if (typeof content !== "string" || !content.trim()) return { ok: false, reason: "Datei leer" };
  const delimiter = mapping.delimiter ?? ";";
  const lines = content.replace(/^﻿/, "").split(/\r?\n/);
  const header = splitLine(lines[0], delimiter);
  if (!header) return { ok: false, reason: "Kopfzeile nicht lesbar" };
  const used = [mapping.day, mapping.amount, ...mapping.key, ...(mapping.currency ? [mapping.currency] : []), ...(mapping.channel ? [mapping.channel] : [])];
  if (!mapping.key.length) return { ok: false, reason: "Schlüsselspalten fehlen in der Zuordnung" };
  if (new Set(header).size !== header.length) return { ok: false, reason: "Kopfzeile enthält doppelte Spalten" };
  const missing = used.filter(column => !header.includes(column));
  if (missing.length) return { ok: false, reason: `Spalten fehlen: ${missing.join(", ")}` };
  const unknown = header.filter(column => !used.includes(column) && !(mapping.ignore ?? []).includes(column));
  if (unknown.length) return { ok: false, reason: `Unbekannte Spalten: ${unknown.join(", ")} – Exportformat prüfen und Zuordnung anpassen` };
  const index = (column: string) => header.indexOf(column);

  const rows: RevenueCsvRow[] = [], rejectedRows: RowResult[] = [];
  for (let number = 1; number < lines.length; number++) {
    if (!lines[number].trim()) continue;
    const line = number + 1;
    const cells = splitLine(lines[number], delimiter);
    if (!cells || cells.length !== header.length) { rejectedRows.push({ line, status: "rejected", reason: "Spaltenanzahl passt nicht zur Kopfzeile" }); continue; }
    const day = parseDay(cells[index(mapping.day)]);
    if (!day) { rejectedRows.push({ line, status: "rejected", reason: "Datum ungültig" }); continue; }
    const cents = parseDecimal(cells[index(mapping.amount)], 2, true);
    if (cents === null) { rejectedRows.push({ line, status: "rejected", reason: "Betrag ungültig oder leer" }); continue; }
    if (mapping.currency && cells[index(mapping.currency)].toUpperCase() !== "EUR") { rejectedRows.push({ line, status: "rejected", reason: "Währung nicht EUR" }); continue; }
    const keyParts = mapping.key.map(column => cells[index(column)]);
    if (keyParts.some(part => !part)) { rejectedRows.push({ line, status: "rejected", reason: "Schlüsselspalte leer" }); continue; }
    rows.push({ line, day, cents, channel: mapping.channel ? cells[index(mapping.channel)] || null : null, key: keyParts.join("|") });
  }
  // A key that appears more than once is ambiguous: all its rows are rejected, none is imported.
  const count = new Map<string, number>();
  for (const row of rows) count.set(row.key, (count.get(row.key) ?? 0) + 1);
  const kept = rows.filter(row => count.get(row.key) === 1);
  for (const row of rows) if (count.get(row.key)! > 1) rejectedRows.push({ line: row.line, status: "rejected", reason: "Schlüssel mehrfach in der Datei" });
  return { ok: true, rows: kept, rejected: rejectedRows.sort((a, b) => a.line - b.line) };
}

// Imports parsed rows as measured revenue of one department (source partnernet_export). The reference is a hash of the
// configured key, so the same row from a later export is recognised and never counted twice.
export async function importRevenueCsv(db: Database, rows: readonly RevenueCsvRow[], target: { department: string; channel: string }): Promise<RowResult[]> {
  if (!isDepartment(target.department)) return rows.map(row => ({ line: row.line, status: "rejected" as const, reason: "Abteilung nicht im Register" }));
  const fallback = text(target.channel, 60);
  const results: RowResult[] = [];
  for (const row of rows) {
    const channel = text(row.channel, 60) ?? fallback;
    if (!channel) { results.push({ line: row.line, status: "rejected", reason: "Kanal fehlt" }); continue; }
    const sourceRef = `partnernet:${createHash("sha256").update(`${target.department}|${row.key}`).digest("hex").slice(0, 40)}`;
    results.push({ line: row.line, ...await insertRevenue(db, { periodStart: row.day, periodEnd: row.day, department: target.department, channel,
      cents: row.cents, kind: "measured", source: "partnernet_export", sourceRef }) });
  }
  return results;
}
