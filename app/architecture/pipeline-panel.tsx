"use client";

import { useState } from "react";
import type { PipelineView, Station, StationState, Track } from "@/lib/architecture/pipeline-snapshot";

// Operations view: one column of stations per content path, readable on a phone. Shows only what the server read from the
// database; "unbekannt" stays "unbekannt". Read-only: no buttons that start, approve or publish anything.

const STATE: Record<StationState, { label: string; className: string }> = {
  belegt: { label: "belegt", className: "pvOk" },
  wartet_betreiber: { label: "wartet auf dich", className: "pvWait" },
  blockiert: { label: "blockiert", className: "pvBad" },
  aus: { label: "aus", className: "pvOff" },
  unbekannt: { label: "unbekannt", className: "pvOff" },
};
const time = (value: string | null) => value ? new Date(value).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "–";

function StationCard({ station, index }: { station: Station; index: number }) {
  const state = STATE[station.state];
  return <li className={`pvStation ${state.className}`} data-testid={`pv-${station.id}`}>
    <div className="pvHead"><b>{index + 1}. {station.label}</b><span className="pvBadge">{state.label}</span></div>
    <p>{station.reason}</p>
    <dl>
      <dt>Zuletzt erfolgreich</dt><dd>{time(station.lastOkAt)}</dd>
      {station.current && <><dt>Aktuell</dt><dd>{station.current.status}{station.current.at ? ` · ${time(station.current.at)}` : ""}</dd>
        {station.current.contentId && <><dt>ID</dt><dd><code>{station.current.contentId}</code></dd></>}
        {station.current.blocker && <><dt>Blocker</dt><dd>{station.current.blocker}</dd></>}</>}
      {station.next && <><dt>Nächster Schritt</dt><dd>{station.next.action} <em>({station.next.owner})</em></dd></>}
      <dt>Quelle</dt><dd>{station.source.join(", ")}</dd>
    </dl>
    {!!station.publications?.length && <ul className="pvPubs">{station.publications.map((item, i) => <li key={`${item.platform}-${item.externalId ?? i}`}>
      {item.platform} · {item.status} · {time(item.at)}{item.externalId && <> · ID <code>{item.externalId}</code></>}
      {item.url && <> · <a href={item.url} target="_blank" rel="noreferrer noopener">ansehen ↗</a></>}</li>)}</ul>}
    {!!station.metrics?.length && <ul className="pvPubs">{station.metrics.map(metric => <li key={metric.label}>{metric.label}: <b>{metric.value === null ? "unbekannt" : metric.value}</b> <small>({metric.basis})</small></li>)}</ul>}
  </li>;
}

function TrackView({ track }: { track: Track }) {
  return <section className="pvTrack" aria-label={track.label}>
    <h4>{track.label}</h4><p className="muted">{track.plain}</p>
    <ol className="pvStations">{track.stations.map((station, index) => <StationCard key={station.id} station={station} index={index} />)}</ol>
  </section>;
}

export function PipelinePanel({ view }: { view?: PipelineView }) {
  const [trackId, setTrackId] = useState<Track["id"]>("affiliate");
  if (!view) return <p className="muted">Betriebsansicht nicht verfügbar (ältere Serverantwort).</p>;
  if (!view.available) return <p className="muted" data-testid="pv-unavailable">Keine Nachweise lesbar: {view.reason}</p>;
  const track = view.tracks.find(item => item.id === trackId) ?? view.tracks[0];
  const service = view.serviceWindow;
  return <div className="pvRoot" data-testid="pipeline-view">
    <p className="muted">Stand {time(view.generatedAt)} · „belegt“ heißt: in der Datenbank steht ein erfolgreicher Lauf. Konfigurierte Zugänge allein machen nichts grün.</p>
    {service && <p className={service.open ? "pvNote" : "pvNote pvWarn"}>
      WhatsApp-24-h-Fenster: {service.open ? `offen bis ${time(service.openUntil)}` : service.lastInboundAt ? `geschlossen seit ${time(service.openUntil)}` : "geschlossen (keine eingehende Nachricht protokolliert)"}.
      {" "}Ohne offenes Fenster werden Freigabeanfragen und Themenvorschläge gehalten, bis du schreibst. <small>({service.basis})</small></p>}
    {view.undelivered && <p className="pvNote">Nicht zugestellte Tagesentwürfe (7 Tage): <b>{view.undelivered.drafts} Entwürfe</b> aus {view.undelivered.runs} Cron-Aufrufen. <small>({view.undelivered.basis})</small></p>}
    <div role="group" aria-label="Weg" className="ccSegment">{view.tracks.map(item =>
      <button key={item.id} type="button" className={item.id === track?.id ? "primary" : "ghost"} aria-pressed={item.id === track?.id} onClick={() => setTrackId(item.id)}>{item.label}</button>)}</div>
    {track && <TrackView track={track} />}
  </div>;
}
