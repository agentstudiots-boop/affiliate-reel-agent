"use client";

import { useState } from "react";

type Price = { id: string; provider: string; item: string; unit: string; priceMicros: number; currency: string;
  validFrom: string; validTo: string | null; sourceUrl: string; enteredBy: string };

const UNITS: Record<string, string> = { input_token: "Eingabe-Token", output_token: "Ausgabe-Token", second: "Sekunde", image: "Bild",
  video_second: "Videosekunde", request: "Anfrage", month: "Monat" };
const perUnit = (micros: number, currency: string) => `${(micros / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 6 })} ${currency}`;

// Price catalogue for the cost ledger: prices are entered by the operator from the provider's public price page. Without a
// price the cost of a call stays "unbekannt" – never 0.
export function PriceCatalogPanel() {
  const [prices, setPrices] = useState<Price[] | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ provider: "replicate", item: "openai/gpt-4.1", unit: "input_token", price: "", currency: "USD", validFrom: "", sourceUrl: "" });
  async function load() {
    setMessage("");
    const response = await fetch("/api/controlling/prices", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error || "Preiskatalog nicht lesbar."); return; }
    setPrices(result.prices);
  }
  async function add(event: React.FormEvent) {
    event.preventDefault(); setMessage("");
    const response = await fetch("/api/controlling/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", ...form }) });
    const result = await response.json();
    setMessage(result.status === "recorded" ? "Preis gespeichert." : result.status === "duplicate" ? "Preis war bereits erfasst." : result.reason || result.error || "Nicht gespeichert.");
    if (response.ok) await load();
  }
  const field = (key: keyof typeof form, label: string, placeholder = "") => <label>{label}<br />
    <input value={form[key]} placeholder={placeholder} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>;
  return <details>
    <summary>Preiskatalog (Kostenbuch)</summary>
    <p className="muted">Preise nur von der öffentlichen Preisseite des Anbieters übernehmen, mit Quelle und Gültigkeit. Ohne Preis bleiben Kosten „unbekannt“. Fremdwährung (z. B. USD) wird gespeichert, aber nur mit belegtem Kurs in Euro umgerechnet.</p>
    <button type="button" className="ghost" onClick={load}>Preise laden</button>
    {prices && (prices.length ? <div style={{overflowX:"auto"}}><table><thead><tr><th>Anbieter / Modell</th><th>Einheit</th><th>Preis je Einheit</th><th>gültig</th><th>Quelle</th></tr></thead><tbody>
      {prices.map(price => <tr key={price.id}><td>{price.provider}<br /><small>{price.item}</small></td><td>{UNITS[price.unit] ?? price.unit}</td>
        <td>{perUnit(price.priceMicros, price.currency)}</td><td>{price.validFrom.slice(0, 10)} – {price.validTo ? price.validTo.slice(0, 10) : "offen"}</td>
        <td><a href={price.sourceUrl} target="_blank" rel="noopener noreferrer">Quelle ↗</a></td></tr>)}
    </tbody></table></div> : <p>Noch keine Preise erfasst – alle Modellkosten sind „unbekannt“.</p>)}
    <form onSubmit={add} style={{display:"grid", gap:"0.5rem", maxWidth:"32rem"}}>
      {field("provider", "Anbieter", "replicate")}{field("item", "Modell", "openai/gpt-4.1")}
      <label>Einheit<br /><select value={form.unit} onChange={event => setForm({ ...form, unit: event.target.value })}>
        {Object.entries(UNITS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {field("price", "Preis je Einheit (Dezimalkomma, bis 6 Stellen)", "0,000002")}{field("currency", "Währung", "USD")}
      {field("validFrom", "gültig ab (TT.MM.JJJJ)", "24.10.2026")}{field("sourceUrl", "Quelle (https://…)", "https://replicate.com/openai/gpt-4.1")}
      <button type="submit">Preis speichern</button>
    </form>
    {message && <p role="status">{message}</p>}
  </details>;
}
