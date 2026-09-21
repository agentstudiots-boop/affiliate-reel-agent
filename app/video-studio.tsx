"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { Product, ReelConcept } from "@/lib/types";

const jobSchema = z.object({
  taskId: z.string().optional(),
  status: z.string(),
  videoUrl: z.string().url().optional(),
  costCredits: z.number().nonnegative().optional(),
});
type VideoJob = z.infer<typeof jobSchema>;

export function VideoStudio({ product, concept }: { product: Product; concept: ReelConcept }) {
  const storageKey = `affiliate-video-v1:${JSON.stringify([product, concept])}`;
  const [job, setJob] = useState<VideoJob | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [paused, setPaused] = useState(false);
  const [starting, setStarting] = useState(false);
  const startingRef = useRef(false);

  // Save the start intent before contacting the paid API. An interrupted request
  // must never silently become a fresh paid request after a reload.
  const save = useCallback((next: VideoJob) => {
    localStorage.setItem(storageKey, JSON.stringify(next));
    setJob(next);
  }, [storageKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) setJob(jobSchema.parse(JSON.parse(saved)));
        setReady(true);
      } catch {
        setError("Der gespeicherte Video-Auftrag kann nicht gelesen werden. Bitte zuerst den Auftrag bei Runway prüfen; ein neuer Start bleibt gesperrt.");
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  const taskId = job?.taskId;
  const finished = Boolean(job?.videoUrl || job?.status === "FAILED" || job?.status === "CANCELLED");

  useEffect(() => {
    if (!ready || !taskId || finished || paused) return;
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch(`/api/video/status?taskId=${encodeURIComponent(taskId!)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || "Video-Status nicht verfügbar.");
        const next = jobSchema.parse({
          taskId, status: data.status, videoUrl: data.videoUrl, costCredits: data.costCredits,
        });
        save(next);
        if (data.error) setError(data.error);
        if (!next.videoUrl && next.status !== "FAILED" && next.status !== "CANCELLED") {
          timer = window.setTimeout(poll, 6000);
        }
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Video-Status nicht verfügbar.");
        setPaused(true);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [ready, taskId, finished, paused, save]);

  async function createVideo() {
    if (!ready || (job && job.status !== "NOT_STARTED") || startingRef.current) return;
    if (!window.confirm("Der Agent erzeugt jetzt einen neutralen 10-Sekunden-Clip. Dabei werden Runway-Credits verbraucht. Fortfahren?")) return;
    startingRef.current = true;
    setStarting(true);
    setError("");
    try {
      // Also catch an intent saved by another tab before this click.
      const existing = localStorage.getItem(storageKey);
      if (existing) {
        const previous = jobSchema.parse(JSON.parse(existing));
        if (previous.status !== "NOT_STARTED") {
          setJob(previous);
          return;
        }
      }
      save({ status: "STARTING" });
      const visual = concept.scenes.map((scene) => scene.visual).join(" ").slice(0, 700);
      const response = await fetch("/api/video/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productName: product.name, prompt: visual }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.notStarted === true) save({ status: "NOT_STARTED" });
        throw new Error(data.error || "Der Start konnte nicht bestätigt werden.");
      }
      const id = z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/).parse(data.taskId);
      const next = jobSchema.parse({ taskId: id, status: "PENDING", costCredits: data.estimatedCredits });
      // Keep a received ID in memory even if browser storage becomes unavailable.
      setJob(next);
      save(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Der Start konnte nicht bestätigt werden.");
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  return <section className="videoStudio">
    <h3>Runway-Videostudio</h3>
    <p className="videoNote">Der Agent erzeugt einen neutralen 10-Sekunden-Clip im Hochformat. Er bildet nicht zwingend das exakte Produktmodell ab. Auftrag und Download bleiben in diesem Browser gespeichert.</p>
    {(!job || job.status === "NOT_STARTED") && <button className="primary" type="button" disabled={!ready || starting} onClick={createVideo}>{ready ? "Agent erstellt 10-Sekunden-Clip" : "Gespeicherten Auftrag laden …"}</button>}
    {job && !job.videoUrl && <p role="status">{starting ? "Video-Auftrag wird gestartet …" : job.taskId ? `Runway: ${job.status}` : job.status === "NOT_STARTED" ? "Kein Video gestartet. Nach Behebung der Ursache kannst du erneut starten." : "Start nicht bestätigt. Bitte in Runway prüfen, ob ein Auftrag angelegt wurde. Es wird kein zweiter Clip gestartet."}</p>}
    {job?.status === "STARTING" && !job.taskId && !starting && <button className="secondary" type="button" onClick={() => {
      if (!window.confirm("Nur zurücksetzen, wenn Runway den Start ausdrücklich mit einem Validierungsfehler abgelehnt hat oder du dort geprüft hast, dass kein Auftrag angelegt wurde. Ist das bestätigt?")) return;
      try { save({ status: "NOT_STARTED" }); setError(""); }
      catch { setError("Die Startsperre konnte nicht zurückgesetzt werden."); }
    }}>Abgelehnten Start zurücksetzen</button>}
    {job?.taskId && <small>Auftrag: {job.taskId}</small>}
    {paused && taskId && !finished && <button className="secondary" type="button" onClick={() => { setError(""); setPaused(false); }}>Status erneut abrufen – kein neuer Clip</button>}
    {job?.costCredits !== undefined && <small className="cost">Runway-Kosten: {job.costCredits} Credits ≈ {(job.costCredits / 100).toFixed(2)} US-Dollar</small>}
    {error && <p className="error" role="alert">{error}</p>}
    {job?.videoUrl && <div className="videoReady"><video controls playsInline src={job.videoUrl} /><a className="track" href={job.videoUrl} target="_blank" rel="noopener">MP4 öffnen / herunterladen ↗</a><p>Erst prüfen. Danach kann der Clip veröffentlicht und in Google Drive archiviert werden.</p></div>}
  </section>;
}
