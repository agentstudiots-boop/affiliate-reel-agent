// Executive section of the weekly report (task B-10). Read-only: one READ ONLY transaction over the task ledger (039),
// the decision requests (041) and the cost ledger (040). Nothing here sends, decides or approves: open decision requests are
// only listed as a reminder – they can be approved solely as a reply to their own request message (lib/enterprise/decisions.ts),
// never as a reply to the weekly report. Missing tables or a database error give an "unreadable" section, never an exception,
// so the weekly report itself never fails because of the executive level. Used only with EXECUTIVE_WEEKLY_REPORT=true.
//
// Requests past their expiry count as expired even while still 'pending': expireDecisions runs only in the executive cycle
// (B-07, off by default), and an expired request can never be approved (same rule as lib/architecture/enterprise-snapshot.ts).

import type { Database } from "../memory/db";

export type ExecutiveWeekly =
  | { readable: false }
  | {
      readable: true;
      tasks: { created: number; succeeded: number; failed: number; unknown: number; open: number; cancelled: number };
      unknownOpen: number;
      decisions: {
        pending: { subject: string; level: string; expiresAt: string }[];
        pendingTotal: number;
        approved: number;
        rejected: number;
        expired: number;
      };
      disputedReservations: number;
      // Forecasts are no costs and are left out; estimated amounts are shown apart from measured ones.
      costs: { entries: number; measuredEurMicros: number; estimatedEurMicros: number; withoutPrice: number; otherCurrency: number };
    };

export const MAX_LISTED_DECISIONS = 5;
const SUBJECT_CHARS = 120;
const OPEN = ["queued", "leased", "running", "needs_decision"];

const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

export async function readExecutiveWeekly(db: Database, start: Date, end: Date, asOf: Date = new Date()): Promise<ExecutiveWeekly> {
  const range = [start.toISOString(), end.toISOString()];
  const now = asOf.toISOString();
  try {
    return await db.transaction(async sql => {
      await sql.query("SET TRANSACTION READ ONLY");
      const tasks = (await sql.query(`SELECT count(*)::int AS created,
          count(*) FILTER (WHERE status='succeeded')::int AS succeeded,
          count(*) FILTER (WHERE status IN ('failed','dead'))::int AS failed,
          count(*) FILTER (WHERE status='outcome_unknown')::int AS unknown,
          count(*) FILTER (WHERE status = ANY($3::text[]))::int AS open,
          count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
          (SELECT count(*)::int FROM enterprise_tasks WHERE status='outcome_unknown') AS unknown_open
        FROM enterprise_tasks WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz`, [...range, OPEN])).rows[0] ?? {};
      const pending = (await sql.query(`SELECT subject, level, expires_at, count(*) OVER ()::int AS total
        FROM enterprise_decisions WHERE status='pending' AND expires_at > $2::timestamptz ORDER BY expires_at, created_at LIMIT $1`,
        [MAX_LISTED_DECISIONS, now])).rows;
      const decided = (await sql.query(`SELECT
          count(*) FILTER (WHERE status='approved' AND decided_at >= $1::timestamptz AND decided_at < $2::timestamptz)::int AS approved,
          count(*) FILTER (WHERE status='rejected' AND decided_at >= $1::timestamptz AND decided_at < $2::timestamptz)::int AS rejected,
          count(*) FILTER (WHERE (status='expired' OR (status='pending' AND expires_at <= $3::timestamptz))
            AND expires_at >= $1::timestamptz AND expires_at < $2::timestamptz)::int AS expired
        FROM enterprise_decisions`, [...range, now])).rows[0] ?? {};
      const disputed = (await sql.query("SELECT count(*)::int AS disputed FROM budget_reservations WHERE status='disputed'")).rows[0] ?? {};
      const costs = (await sql.query(`SELECT count(*)::int AS entries,
          COALESCE(sum(amount_micros) FILTER (WHERE currency='EUR' AND value_kind='measured'),0)::bigint AS measured,
          COALESCE(sum(amount_micros) FILTER (WHERE currency='EUR' AND value_kind='estimated'),0)::bigint AS estimated,
          count(*) FILTER (WHERE amount_micros IS NULL)::int AS without_price,
          count(*) FILTER (WHERE currency IS NOT NULL AND currency <> 'EUR')::int AS other_currency
        FROM cost_entries WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz AND value_kind <> 'forecast'`, range)).rows[0] ?? {};
      return {
        readable: true as const,
        tasks: { created: num(tasks.created), succeeded: num(tasks.succeeded), failed: num(tasks.failed), unknown: num(tasks.unknown),
          open: num(tasks.open), cancelled: num(tasks.cancelled) },
        unknownOpen: num(tasks.unknown_open),
        decisions: {
          pending: pending.map(row => ({ subject: String(row.subject), level: String(row.level),
            expiresAt: new Date(row.expires_at as string | Date).toISOString() })),
          pendingTotal: num(pending[0]?.total),
          approved: num(decided.approved), rejected: num(decided.rejected), expired: num(decided.expired),
        },
        disputedReservations: num(disputed.disputed),
        costs: { entries: num(costs.entries), measuredEurMicros: num(costs.measured), estimatedEurMicros: num(costs.estimated),
          withoutPrice: num(costs.without_price), otherCurrency: num(costs.other_currency) },
      };
    });
  } catch {
    return { readable: false };
  }
}

// Free text from a decision request: one line, bounded, so the report stays short and its layout cannot be broken.
function oneLine(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SUBJECT_CHARS ? `${flat.slice(0, SUBJECT_CHARS - 1)}…` : flat;
}

function euroFromMicros(micros: number) {
  if (micros > 0 && micros < 10_000) return "unter 0,01 €";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(micros / 1_000_000);
}

export function formatExecutiveWeekly(section: ExecutiveWeekly): string {
  if (!section.readable) return "Executive-Ebene: nicht lesbar (Tabellen fehlen oder Datenbankfehler) – keine Angaben.";
  const berlin = (iso: string) => new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit" });
  const { tasks, decisions, costs } = section;
  const lines = [
    "Executive-Ebene (nur Bericht, keine Wirkung)",
    tasks.created
      ? `Aufgaben neu: ${tasks.created}, davon heute: erledigt ${tasks.succeeded} · fehlgeschlagen ${tasks.failed} · Wirkung unbekannt ${tasks.unknown} · offen ${tasks.open}${tasks.cancelled ? ` · abgebrochen ${tasks.cancelled}` : ""}`
      : "Aufgaben neu: keine",
  ];
  if (section.unknownOpen) lines.push(`Aufgaben mit unbekannter Wirkung insgesamt: ${section.unknownOpen} – bitte prüfen, sie werden nie automatisch wiederholt`);
  if (decisions.pendingTotal) {
    lines.push(`Offene Entscheidungsvorlagen: ${decisions.pendingTotal}`);
    for (const item of decisions.pending) lines.push(`– ${oneLine(item.subject)} (${item.level}, gültig bis ${berlin(item.expiresAt)})`);
    if (decisions.pendingTotal > decisions.pending.length) lines.push(`– und ${decisions.pendingTotal - decisions.pending.length} weitere`);
    lines.push("Freigeben oder Ablehnen nur als Antwort auf die jeweilige Anfrage-Nachricht, nicht auf diesen Bericht.");
  } else {
    lines.push("Offene Entscheidungsvorlagen: keine");
  }
  lines.push(`Entschieden diese Woche: freigegeben ${decisions.approved} · abgelehnt ${decisions.rejected} · abgelaufen ${decisions.expired}`);
  lines.push(`Strittige Budgetreservierungen: ${section.disputedReservations || "keine"}`);
  if (!costs.entries) {
    lines.push("Kostenbuch diese Woche: keine Einträge");
  } else {
    const extra = [costs.estimatedEurMicros ? `geschätzt ${euroFromMicros(costs.estimatedEurMicros)}` : "",
      costs.withoutPrice ? `${costs.withoutPrice} ${costs.withoutPrice === 1 ? "Eintrag" : "Einträge"} ohne Preis (Betrag unbekannt)` : "",
      costs.otherCurrency ? `${costs.otherCurrency} in anderer Währung` : ""].filter(Boolean);
    lines.push(`Kostenbuch diese Woche: gemessen ${euroFromMicros(costs.measuredEurMicros)}${extra.length ? ` + ${extra.join(", ")}` : ""}`);
  }
  return lines.join("\n");
}
