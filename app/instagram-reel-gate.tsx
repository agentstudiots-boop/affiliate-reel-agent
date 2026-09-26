"use client";
import { useCallback, useEffect, useState } from "react";
import type { ContentJob } from "@/lib/content/schema";

type Reel = { id: string; status: string; caption: string; videoUrl: string; permalink: string | null;
  feedback: string; whatsappMessageId: string | null; whatsappSendAttempted: boolean };

export function InstagramReelGate({ job, password }: { job: ContentJob; password: string }) {
  const [reel, setReel] = useState<Reel | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!password) return;
    const response = await fetch(`/api/instagram/reel?jobId=${encodeURIComponent(job.id)}`, { headers: { "x-content-password": password }, cache: "no-store" });
    if (response.ok) setReel((await response.json()).publication);
  }, [job.id,password]);
  useEffect(() => { const initial = setTimeout(() => { void refresh(); },0); const timer = setInterval(() => { void refresh(); },15000); return () => { clearTimeout(initial); clearInterval(timer); }; },[refresh]);
  async function action(name: "request" | "publish" | "poll") {
    setBusy(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/instagram/reel", { method: "POST", headers: { "Content-Type": "application/json", "x-content-password": password }, body: JSON.stringify({ jobId: job.id, action: name }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Instagram-Status unklar.");
      setReel(data.publication);
      setNotice(data.whatsapp === "service_window_required" ? "Schreibe dem Projekt-WhatsApp-Konto zuerst eine Nachricht. Danach kannst du die Reel-Freigabe hier senden."
        : data.approvalSent ? "Video und Text wurden per WhatsApp zur separaten Veröffentlichungsfreigabe gesendet."
          : data.stage === "processing" ? "Instagram verarbeitet das Video. Danach hier die Verarbeitung prüfen."
            : data.stage === "published" ? "Reel veröffentlicht." : data.stage === "unknown" ? "Meta hat den Container abgelehnt. Kein weiterer Veröffentlichungsversuch."
              : "Status aktualisiert.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Status nicht verfügbar."); }
    finally { setBusy(false); }
  }
  return <section className="reviewBox"><h4>Instagram Reel · eigene Veröffentlichungsfreigabe</h4>
    <p>Das fertige MP4 und der Text müssen vor dem Post geprüft werden. Der Affiliate-Link steht in der Caption, ist dort aber nicht anklickbar.</p>
    {!reel && <button type="button" disabled={busy || !password} onClick={() => action("request")}>Video & Text per WhatsApp freigeben lassen</button>}
    {reel && <><p>Status: <strong>{reel.status}</strong></p><p><a href={reel.videoUrl} target="_blank" rel="noreferrer">Video ansehen ↗</a></p>
      <div className="postCopy">{reel.caption}</div>
      {reel.status === "pending" && !reel.whatsappSendAttempted && <button type="button" disabled={busy} onClick={() => action("request")}>WhatsApp-Freigabe senden</button>}
      {reel.status === "pending" && reel.whatsappSendAttempted && !reel.whatsappMessageId && <p>WhatsApp-Versand unklar. Kein zweites Senden; Status manuell klären.</p>}
      {reel.status === "pending" && reel.whatsappMessageId && <p>Warte auf deine Antwort auf die neue WhatsApp-Nachricht.</p>}
      {reel.status === "approved" && <button type="button" disabled={busy} onClick={() => action("publish")}>Freigegebenen Reel-Upload genau einmal starten</button>}
      {reel.status === "processing" && <button type="button" disabled={busy} onClick={() => action("poll")}>Verarbeitung prüfen und Reel veröffentlichen</button>}
      {reel.status === "unknown" && <p>Meta-Ergebnis unklar oder Container fehlgeschlagen. Ein neuer Upload ist gesperrt; bitte Instagram direkt prüfen.</p>}
      {reel.permalink && <p><a href={reel.permalink} target="_blank" rel="noreferrer">Veröffentlichtes Reel öffnen ↗</a></p>}
      {reel.status === "published" && !reel.permalink && <p>Instagram hat eine Media-ID bestätigt. Der Direktlink ist noch nicht verfügbar.</p>}
      {reel.status === "published" && !reel.permalink && <button type="button" disabled={busy} onClick={() => action("poll")}>Instagram-Link erneut abfragen</button>}
      {reel.feedback && <p>Änderungswunsch: {reel.feedback} · Für ein neues Video einen neuen Content-Plan erstellen.</p>}</>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="error">{error}</p>}
  </section>;
}
