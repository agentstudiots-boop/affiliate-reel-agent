"use client";

import { useEffect, useState } from "react";
import type { ContentJob } from "@/lib/content/schema";
import type { ProductionRun } from "@/lib/production/schema";
import type { VideoProviderDecision } from "@/lib/production/policy";

type StatusResponse = {
  run: ProductionRun | null;
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

export function ProductionGate({ job, password }: { job: ContentJob; password: string }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (!password) return;
    try {
      const response = await fetch(`/api/production?jobId=${encodeURIComponent(job.id)}`, {
        headers: { "x-content-password": password },
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Produktionsstatus nicht verfügbar.");
      setStatus(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Produktionsstatus nicht verfügbar.");
    }
  }

  useEffect(() => { void load(); }, [job.id, password]);

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
      {status?.configuration.facelessApiKeyConfigured && run.provider === "faceless_video" && !status.configuration.facelessApiContractVerified
        ? <p className="error">Faceless.video-Key ist vorgesehen, aber der offizielle API-Vertrag dieses Anbieters ist noch nicht verifiziert. Deshalb wird kein Endpoint geraten und kein Credit ausgegeben.</p>
        : null}
      {status && !status.configuration.whatsappApprovalReady && <p className="muted">WhatsApp ist teilweise vorbereitet. Für den signierten Freigabe-Webhook fehlen noch mindestens Verify-Token/App-Secret oder die freigegebene Empfänger-WA-ID.</p>}
      <p className="muted">Die alte Runway-10-Sekunden-Funktion gehört nicht zu diesem Produktionsweg.</p>
    </div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
