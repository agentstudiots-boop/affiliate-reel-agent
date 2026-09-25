"use client";

import { useState } from "react";

type Snapshot = {
  environment: "production" | "preview_or_local";
  readiness: { cronSecretConfigured: boolean; tavilyConfigured: boolean; whatsappConfigured: boolean; dailyTemplateConfigured: boolean; weeklyTemplateConfigured: boolean;
    blobConfigured: boolean; imageProviderConfigured: boolean; imageProviderReason: string };
  days: Array<{ day: string; jobId: string; status: string; product: string; format: string | null;
    notificationSent: boolean; contentApprovalSent: boolean; publicationStatus: string | null;
    publishingApprovalSent: boolean; permalink: string | null }>;
  posts: Array<{ jobId: string; platform: string; product: string; url: string; publishedAt: string;
    measurement: null | { observedAt: string; clicks: number; conversions: number; revenueCents: number; costCents: number | null; source: string } }>;
  latestReport: null | { weekStart: string; status: string; text: string };
};

const euro = (cents: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
const dailyLabels: Record<string,string> = {
  claimed: "Recherche gestartet", planning: "Entwurf in Arbeit", awaiting_approval: "Planfreigabe offen",
  content_approved: "Plan freigegeben", needs_input: "Klärung nötig", failed: "Fehlgeschlagen",
  changes_requested: "Änderung angefragt", rejected: "Abgelehnt",
};
const publicationLabels: Record<string,string> = {
  preparing: "Bildvorbereitung", pending: "Posting-Freigabe offen", approved: "Posting freigegeben",
  publishing: "Veröffentlichung läuft", published: "Veröffentlicht", unknown: "Ergebnis unklar – prüfen",
  changes_requested: "Änderung angefragt", rejected: "Abgelehnt",
};

export function OperationsPanel({ password }: { password: string }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/operations", { cache: "no-store", headers: { "x-content-password": password } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Tageslauf nicht abrufbar.");
      setData(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Tageslauf nicht abrufbar."); }
    finally { setLoading(false); }
  }
  return <section className="reviewBox">
    <h3>Tageslauf &amp; Ergebnisse</h3>
    <p>Hier siehst du, ob der Tagesentwurf, beide Freigaben und eine Veröffentlichung wirklich stattgefunden haben. Zahlen erscheinen nur, wenn eine Messung eingetragen ist.</p>
    <button type="button" className="ghost" disabled={!password || loading} onClick={refresh}>{loading ? "Lade …" : "Aktuellen Stand laden"}</button>
    {error && <p role="alert" className="error">{error}</p>}
    {data && <>
      <p><strong>Umgebung:</strong> {data.environment === "production" ? "Production" : "Preview / lokal – kein automatischer Vercel-Cronlauf"}</p>
      <p><strong>Konfiguration:</strong> Cron-Zugang {data.readiness.cronSecretConfigured ? "vorhanden" : "fehlt"} · Tavily {data.readiness.tavilyConfigured ? "bereit" : "fehlt"} · WhatsApp {data.readiness.whatsappConfigured ? "bereit" : "unvollständig"} · Tagesvorlage {data.readiness.dailyTemplateConfigured ? "aktiv" : "fehlt"} · Bildprovider {data.readiness.imageProviderConfigured ? "bereit" : data.readiness.imageProviderReason} · Blob {data.readiness.blobConfigured ? "bereit" : "fehlt"}.</p>
      <h4>Letzte Tagesläufe</h4>
      {data.days.length ? <div style={{overflowX:"auto"}}><table><thead><tr><th>Tag</th><th>Produkt</th><th>Planung</th><th>WhatsApp</th><th>Beitrag</th></tr></thead><tbody>
        {data.days.map(day => <tr key={day.day}><td>{day.day}</td><td>{day.product}</td><td>{dailyLabels[day.status] || day.status}{day.format ? ` · ${day.format}` : ""}</td>
          <td>{day.contentApprovalSent ? "Plan gesendet" : day.notificationSent ? "Benachrichtigung gesendet – antworte „Entwurf“" : "keine Nachricht bestätigt"}{day.publishingApprovalSent ? " · Posting-Freigabe gesendet" : ""}</td>
          <td>{day.permalink ? <a href={day.permalink} target="_blank" rel="noopener noreferrer">Veröffentlicht ↗</a> : day.publicationStatus ? publicationLabels[day.publicationStatus] || day.publicationStatus : "Noch nicht veröffentlicht"}</td></tr>)}
      </tbody></table></div> : <p>Bislang kein automatischer Tageslauf gespeichert.</p>}
      <h4>Veröffentlichte Beiträge und Messwerte</h4>
      {data.posts.length ? <div style={{overflowX:"auto"}}><table><thead><tr><th>Beitrag</th><th>Letzte Messung</th><th>Klicks</th><th>Verkäufe</th><th>Erlös / Kosten</th></tr></thead><tbody>
        {data.posts.map(post => <tr key={`${post.jobId}-${post.platform}`}><td><a href={post.url} target="_blank" rel="noopener noreferrer">{post.product} ↗</a><br /><small>{new Date(post.publishedAt).toLocaleDateString("de-DE")}</small></td>
          <td>{post.measurement ? <>{new Date(post.measurement.observedAt).toLocaleString("de-DE")}<br /><small>{post.measurement.source}</small></> : "Keine Messung erfasst"}</td>
          <td>{post.measurement?.clicks ?? "–"}</td><td>{post.measurement?.conversions ?? "–"}</td>
          <td>{post.measurement ? `${euro(post.measurement.revenueCents)} / ${post.measurement.costCents === null ? "Kosten unbekannt" : euro(post.measurement.costCents)}` : "–"}</td></tr>)}
      </tbody></table></div> : <p>Noch kein veröffentlichter Beitrag gespeichert.</p>}
      {data.latestReport && <details><summary>Letzte Wochenbilanz · {data.latestReport.weekStart} · {data.latestReport.status}</summary><pre style={{whiteSpace:"pre-wrap"}}>{data.latestReport.text || "Bericht noch nicht erstellt."}</pre></details>}
      <p className="muted">Klicks, Verkäufe und Provisionen stammen aus erfassten Messständen. Zum Eintragen: „Gespeicherten Verlauf laden“, den Job wählen und dessen Leistungsformular öffnen. Ohne PartnerNet-Daten sind diese Werte unbekannt. Die Werte einer Beitragszeile sind der letzte Messstand dieses Beitrags, keine Tageswerte.</p>
    </>}
  </section>;
}
