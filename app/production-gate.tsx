"use client";
import { InstagramReelGate } from "./instagram-reel-gate";

import { useEffect, useState } from "react";
import type { ContentJob } from "@/lib/content/schema";
import type { ProductionRun } from "@/lib/production/schema";
import type { VideoProviderDecision } from "@/lib/production/policy";
import type { ApprovalRequest } from "@/lib/production/schema";

type StatusResponse = {
  run: ProductionRun | null;
  approval?: ApprovalRequest | null;
  progress?: { renderId: string | null; renderAttempted: boolean } | null;
  learningPolicy: VideoProviderDecision;
  configuration: {
    facelessApiKeyConfigured: boolean;
    facelessApiContractVerified: boolean;
    whatsappApprovalReady: boolean;
    spendLocked: boolean;
    whatsapp: Record<string, boolean>;
  };
};

const modeLabel = {
  FACELESS_STORYBOARD: "Faceless Storyboard",
  RUNWAY_SINGLE_CLIP: "Runway Einzelclip",
} as const;

export function ProductionGate({ job, password, onRevised }: { job: ContentJob; password: string; onRevised?: (job: ContentJob) => void }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quote, setQuote] = useState<{ credits: number; balance: number; voices: { id: string; name: string }[] } | null>(null);
  const [script, setScript] = useState("");
  const [voiceId, setVoiceId] = useState("");

  async function refresh() {
    const response = await fetch(`/api/production?jobId=${encodeURIComponent(job.id)}`, { headers: { "x-content-password": password }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Status konnte nicht geladen werden.");
    setStatus(data);
  }

  useEffect(() => {
    if (job.status !== "approved" || job.content?.format !== "video" || !password) return;
    let active = true;
    fetch(`/api/production?jobId=${encodeURIComponent(job.id)}`, { headers: { "x-content-password": password }, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error("Status konnte nicht geladen werden."); return response.json(); })
      .then(data => { if (active) setStatus(data); })
      .catch(() => { if (active) setError("Status konnte nicht geladen werden."); });
    return () => { active = false; };
  }, [job.id, job.status, job.content?.format, password]);

  async function action(name: "quoteVideo" | "requestApproval" | "startVideo" | "pollVideo" | "reviseContent") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/production", {
        method: "POST", headers: { "Content-Type": "application/json", "x-content-password": password },
        body: JSON.stringify({ action: name, jobId: job.id, ...(name === "requestApproval" ? { voiceId } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Aktion fehlgeschlagen; Zustand prüfen.");
      if (name === "quoteVideo") { setQuote(data.quote); setScript(data.script); setVoiceId(data.quote.voices[0]?.id || ""); }
      else if (name === "reviseContent") onRevised?.(data.job);
      else await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Aktion fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  async function prepare() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/production", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-content-password": password },
        body: JSON.stringify({ action: "prepareVideo", jobId: job.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Produktionsweg konnte nicht vorbereitet werden.");
      setStatus({
        run: data.run,
        learningPolicy: data.decision,
        configuration: data.configuration,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Produktionsweg konnte nicht vorbereitet werden.");
    } finally { setBusy(false); }
  }

  if (job.status !== "approved" || job.content?.format !== "video") return null;
  const policy = status?.learningPolicy;
  const run = status?.run;

  return <section className="productionGate">
    <h3>Produktionsfreigabe</h3>
    <p>Der freigegebene Content-Plan ist der Ausgangspunkt. Ein kostenpflichtiger Renderer darf erst nach Kostenangebot und ausdrücklicher WhatsApp-Freigabe gestartet werden.</p>
    {policy && <div className="reviewBox"><strong>Renderer-Regel: {policy.successfulVideos}/{policy.target} erfolgreiche Lernvideos</strong><p>{policy.reason}</p></div>}
    {!run && <button type="button" className="primary" disabled={busy || !password} onClick={prepare}>{busy ? "Produktionsweg wird vorbereitet …" : "Produktionsweg vorbereiten – noch keine Kosten"}</button>}
    {run && <div className="marketingPlan">
      <p><b>Vorgesehener Renderer:</b> {modeLabel[run.providerMode]}</p>
      <p><b>Status:</b> {run.status === "needs_provider_quote" ? "Provider-Angebot / Kostenquote fehlt" : run.status}</p>
      {run.revisionRequest && <p><b>Änderungswunsch:</b> {run.revisionRequest}</p>}
      {run.status === "needs_provider_quote" && <button type="button" disabled={busy || !status?.configuration.facelessApiKeyConfigured} onClick={() => action("quoteVideo")}>Kostenlose Faceless.so-Quote abrufen</button>}
      {quote && run.status === "needs_provider_quote" && <div className="reviewBox">
        <p><b>Provider-Kosten:</b> {quote.credits} Credits · verfügbar: {quote.balance} Credits · EUR-Betrag unbekannt</p>
        <p><b>Erwartete Affiliate-Provision:</b> unbekannt</p>
        <p><b>Sprechtext:</b></p><p style={{ whiteSpace: "pre-wrap" }}>{script}</p>
        <p className="muted">Faceless.so erhält einen Sprechtext und erzeugt eigene statische Szenen. Die visuellen Details und Szenendauern des Plans lassen sich über diese API nicht einzeln festlegen.</p>
        <label>Deutschsprachige Stimme <select value={voiceId} onChange={event => setVoiceId(event.target.value)}>{quote.voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select></label>
        <button type="button" disabled={busy || !voiceId || quote.balance < quote.credits || !status?.configuration.whatsappApprovalReady} onClick={() => action("requestApproval")}>Quote per WhatsApp zur Freigabe senden</button>
      </div>}
      {run.status === "awaiting_whatsapp_approval" && <p>WhatsApp-Freigabe offen. Antworte auf die Nachricht; danach hier den Status neu laden.</p>}
      {run.status === "approved_for_spend" && <button type="button" className="primary" disabled={busy} onClick={() => action("startVideo")}>Freigegebenes Video einmalig erstellen – kostet {run.estimatedProviderCredits} Credits</button>}
      {run.status === "rendering" && <><p>Videostart wurde beansprucht. {run.providerJobId ? "Provider-Auftrag bestätigt." : "Provider-Ergebnis unklar: keinen zweiten kostenpflichtigen Start auslösen."}</p>{run.providerJobId && <button type="button" disabled={busy} onClick={() => action("pollVideo")}>Provider-Status abfragen / MP4 fertigstellen</button>}</>}
      {run.status === "ready" && run.outputUrl && <p><a href={run.outputUrl} target="_blank" rel="noreferrer">Fertiges Video ansehen</a> · Veröffentlichung erfordert eine separate Freigabe.</p>}
      {run.status === "ready" && job.marketing?.primary === "Instagram Reel" && <InstagramReelGate job={job} password={password} />}
      {run.status === "changes_requested" && <><p>Änderungsauftrag gespeichert. Der Orchestrator gibt ihn an den Video-Agenten weiter. Im Referenzmodus sind konkrete Szenen-, CTA- und Tempoänderungen unterstützt.</p><button type="button" disabled={busy} onClick={() => action("reviseContent")}>Änderung bearbeiten und neuen Content-Plan vorlegen</button></>}
      {status?.approval && <p><b>Freigabe:</b> {status.approval.status}{status.approval.whatsappMessageId ? " · WhatsApp-Nachricht bestätigt" : " · Versand nicht bestätigt; manuell prüfen"}</p>}
      {status && !status.configuration.whatsappApprovalReady && <p className="muted">WhatsApp ist teilweise vorbereitet. Für den signierten Freigabe-Webhook fehlen noch mindestens Verify-Token/App-Secret oder die freigegebene Empfänger-WA-ID.</p>}
      <button type="button" disabled={busy} onClick={() => refresh().catch(caught => setError(caught instanceof Error ? caught.message : "Statusfehler"))}>Status neu laden</button>
      <p className="muted">Die alte Runway-10-Sekunden-Funktion gehört nicht zu diesem Produktionsweg.</p>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
