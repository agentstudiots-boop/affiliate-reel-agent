"use client";

import { useState } from "react";
import type { DepartmentView, EnterpriseView } from "@/lib/architecture/enterprise";
import type { DepartmentId } from "@/lib/enterprise/registry";

// Enterprise level of the Command Center in 2D (tasks H-04/H-05): one card per department of the executive register and a
// detail panel. Pure presentation of the `enterprise` contract (H-01): every value is shown with its source, and a part
// without evidence says "keine Daten" – nothing is filled in on the client. Buttons are plain, so the view works without
// WebGL and with the keyboard (Tab, Enter/Leertaste).

type Health = NonNullable<DepartmentView["health"]>;
type Money = NonNullable<NonNullable<DepartmentView["controlling"]>["costs"]>["measured"];

export const HEALTH_LABEL: Record<Health["status"], { label: string; color: string }> = {
  ok: { label: "In Ordnung", color: "#3ddc97" },
  degraded: { label: "Eingeschränkt", color: "#f5c542" },
  error: { label: "Fehler", color: "#ff6b6b" },
  not_configured: { label: "Nicht eingerichtet", color: "#8892a0" },
  unknown: { label: "Unbekannt", color: "#8892a0" },
};
const TASK_LABEL: Record<string, string> = {
  queued: "wartend", leased: "zugeteilt", running: "läuft", succeeded: "erledigt", failed: "fehlgeschlagen",
  outcome_unknown: "Ergebnis unklar", needs_decision: "Entscheidung nötig", cancelled: "abgebrochen", dead: "aufgegeben",
};
const NO_DATA = "keine Daten";

const time = (iso: string | null) => iso ? new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "–";
const euro = (cents: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
export const moneyText = (money: Money | undefined | null) => !money || money.entries === 0 ? NO_DATA
  : money.amountCents === null ? "unbekannt" : `${money.complete ? "" : "mind. "}${euro(money.amountCents)}`;
const evidenceValue = (value: string | number | boolean | null) => value === null ? "–" : typeof value === "boolean" ? (value ? "ja" : "nein")
  : typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? time(value) : String(value);

function HealthChip({ department }: { department: DepartmentView }) {
  if (department.module === "none") return <span className="ccOp muted">nicht angeschlossen</span>;
  if (!department.health) return <span className="ccOp">Bericht nicht lesbar</span>;
  const meta = HEALTH_LABEL[department.health.status];
  return <span className="ccOp" title={department.health.reason}><i style={{ background: meta.color }} aria-hidden />{meta.label}</span>;
}

function tasksText(tasks: DepartmentView["tasks"]) {
  if (!tasks) return NO_DATA;
  if (tasks.total === 0) return "keine Aufgaben";
  const open = (tasks.byStatus.queued ?? 0) + (tasks.byStatus.leased ?? 0) + (tasks.byStatus.running ?? 0);
  return `${tasks.total} gesamt · ${open} offen`;
}

function DepartmentDetail({ department }: { department: DepartmentView }) {
  const health = department.health;
  return <div data-testid="cc-enterprise-detail">
    <h4>{department.label}</h4>
    <dl className="ccStatusRows">
      <div><dt>Zustand</dt><dd><HealthChip department={department} /></dd></div>
      <div><dt>Laufzeitmodul</dt><dd>{department.module === "connected" ? "angeschlossen (nur lesend)" : department.runtime ? "noch nicht gebaut" : "arbeitet außerhalb der App"}</dd></div>
      <div><dt>Höchste eigene Stufe</dt><dd>{department.maxLevel}</dd></div>
      {health && <div><dt>Geprüft</dt><dd>{time(health.checkedAt)}</dd></div>}
    </dl>
    {health?.reason && <p className="ccReason">{health.reason}</p>}
    <h5>Nachweise</h5>
    {health && health.evidence.length ? <ul>{health.evidence.map(item => <li key={item.label}>{item.label}: <b>{evidenceValue(item.value)}</b> <small className="muted">· Quelle: {item.source}</small></li>)}</ul>
      : <p className="muted">{NO_DATA}</p>}
    <h5>Aufgaben</h5>
    {department.tasks ? department.tasks.total === 0 ? <p className="muted">keine Aufgaben im Aufgabenbuch</p>
      : <ul>{Object.entries(department.tasks.byStatus).map(([status, count]) => <li key={status}>{TASK_LABEL[status] ?? status}: <b>{count}</b></li>)}
        <li>letzte Änderung: {time(department.tasks.lastActivityAt)}</li></ul>
      : <p className="muted">{NO_DATA} (Aufgabenbuch nicht lesbar)</p>}
    <h5>Entscheidungsvorlagen</h5>
    {department.decisions ? <p>{department.decisions.pending ? <>offen: <b>{department.decisions.pending}</b> · nächster Ablauf {time(department.decisions.nextExpiry)}</> : "keine offenen Vorlagen"}</p>
      : <p className="muted">{NO_DATA}</p>}
    <h5>Kosten und Erlöse (laufender Monat)</h5>
    {department.controlling ? <ul>
      <li>Kosten gemessen: <b>{moneyText(department.controlling.costs?.measured)}</b></li>
      <li>Kosten geschätzt: <b>{moneyText(department.controlling.costs?.estimated)}</b></li>
      <li>Erlöse gemessen: <b>{moneyText(department.controlling.revenue?.measured)}</b></li>
      <li>Modellaufrufe: <b>{department.controlling.modelUsage ? department.controlling.modelUsage.calls : NO_DATA}</b></li>
    </ul> : <p className="muted">{NO_DATA}</p>}
    <h5>Aufgabenarten</h5>
    {department.taskKinds.length ? <ul>{department.taskKinds.map(kind => <li key={kind}><code>{kind}</code></li>)}</ul> : <p className="muted">keine (arbeitet außerhalb der App)</p>}
    <h5>KI-Agenten (laut Zuordnung, keine Aktivitätsanzeige)</h5>
    {department.agents.length ? <ul>{department.agents.map(agent => <li key={agent}><code>{agent}</code></li>)}</ul> : <p className="muted">keine zugeordnet</p>}
  </div>;
}

export function EnterprisePanel({ view, initial = null }: { view: EnterpriseView | undefined; initial?: DepartmentId | null }) {
  const [selected, setSelected] = useState<DepartmentId | null>(initial);
  if (!view) return <p className="muted" role="status">Unternehmensebene wird von diesem Server noch nicht geliefert.</p>;
  const current = view.departments.find(item => item.id === selected) ?? null;
  const parts: [string, string][] = [["Zustand", view.parts.health], ["Aufgabenbuch", view.parts.tasks], ["Entscheidungen", view.parts.decisions], ["Controlling", view.parts.controlling]];
  return <div data-testid="cc-enterprise">
    <p className="muted">Unternehmensebene, nur lesend · Stand {time(view.generatedAt)} · {parts.map(([label, state]) => `${label}: ${state === "ok" ? "lesbar" : "nicht verfügbar"}`).join(" · ")}</p>
    {!view.available && <p role="status" className="muted">{view.reason ?? "Keine Nachweise lesbar."} Alle Abteilungen werden ohne Werte gezeigt.</p>}
    {view.unknownDepartments.length > 0 && <p role="alert" className="error">Einträge für unbekannte Abteilungen: {view.unknownDepartments.map(item => `${item.department} (${item.tasks} Aufgaben, ${item.pendingDecisions} Vorlagen)`).join(", ")}</p>}
    <div className="ccBody">
      <div className="ccCards" role="list" aria-label="Abteilungen" style={{ alignContent: "start", padding: 0 }}>
        {view.departments.map(department => <div role="listitem" key={department.id}>
          <button type="button" className="ccCard" aria-pressed={selected === department.id} onClick={() => setSelected(selected === department.id ? null : department.id)}>
            <span className="ccCardHead"><b>{department.label}</b><HealthChip department={department} /></span>
            <small>Aufgaben: {tasksText(department.tasks)}</small>
            <small>Offene Entscheidungen: {department.decisions ? department.decisions.pending : NO_DATA}</small>
            <small>Kosten gemessen: {moneyText(department.controlling?.costs?.measured)}</small>
          </button></div>)}
      </div>
      <aside className="ccDetail" aria-live="polite">
        {current ? <DepartmentDetail department={current} /> : <p className="muted">Abteilung wählen, um Zustand, Nachweise, Aufgaben, Entscheidungen, Kosten und Agenten zu sehen.</p>}
      </aside>
    </div>
  </div>;
}
