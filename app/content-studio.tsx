"use client";

import { useEffect, useRef, useState } from "react";
import type { LearningEvidence } from "@/lib/memory/schema";
import { PerformanceEditor } from "@/app/performance-editor";
import { ProductionGate } from "@/app/production-gate";
import { PublicationGate } from "@/app/publication-gate";
import type { Product } from "@/lib/types";
import { parseJob } from "@/lib/content/history";
import { opportunitySchema, terminalStatuses, type Content, type ContentJob, type JobStatus, type Opportunity } from "@/lib/content/schema";

const formatLabels = { video: "Video / Reel", image: "Bild / Carousel", text: "Textpost" };
const labels: Record<JobStatus, string> = {
  queued: "Wartet", checking: "Opportunity prüfen", ideating: "Kreative Ideen", selecting: "Format auswählen", producing: "Entwurf erstellen",
  reviewing: "Qualität prüfen", revising: "Überarbeiten", marketing: "Marketing planen", awaiting_approval: "Freigabe offen", needs_input: "Klärung nötig", failed: "Fehlgeschlagen", interrupted: "Unterbrochen", approved: "Plan freigegeben",
};

export function ContentStudio({ product }: { product: Product }) {
  const [useCase, setUseCase] = useState("");
  const [trend, setTrend] = useState("");
  const [goal, setGoal] = useState<Opportunity["goal"]>("conversion");
  const [budget, setBudget] = useState<Opportunity["budget"]>("balanced");
  const [password, setPassword] = useState("");
  const [jobs, setJobs] = useState<ContentJob[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [category,setCategory] = useState<Opportunity["category"]>("general");
  const [useCaseKey,setUseCaseKey] = useState("general");
  const [targetPlatform,setTargetPlatform] = useState<Opportunity["targetPlatform"]>("any");
  const [databaseReady,setDatabaseReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const job = jobs.find(j => j.id === selectedId) || jobs[0];
  const learningEvidence = job?.events.map(e=>e.data).find(data=>data && typeof data === "object" && "version" in data && data.version === "rules-v1") as LearningEvidence | undefined;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/content", { signal: controller.signal }).then(r => r.json()).then(data => { setDatabaseReady(data.databaseConfigured === true); setReady(true); }).catch(() => {});
    return () => { controller.abort(); abortRef.current?.abort(); };
  }, []);

  function remember(next: ContentJob) {
    setJobs(current => {
      const updated = [next, ...current.filter(item => item.id !== next.id)];
      return updated;
    });
    setSelectedId(next.id);
  }
  async function loadHistory(older = false) {
    setError("");
    try {
      const before=older && jobs.length ? `?before=${encodeURIComponent(jobs[jobs.length-1].createdAt)}` : "";
      const response=await fetch(`/api/content/jobs${before}`,{headers:{"x-content-password":password}});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      const loaded=(data.jobs as unknown[]).map(parseJob);
      setJobs(current=>older ? [...current,...loaded.filter(j=>!current.some(c=>c.id===j.id))] : loaded);
      if(!older)setSelectedId(loaded[0]?.id || "");
      if(!loaded.length)setError("Keine weiteren gespeicherten Jobs gefunden.");
    } catch(caught){setError(caught instanceof Error?caught.message:"Datenbankverlauf nicht erreichbar.");}
  }

  async function plan() {
    if (abortRef.current) return;
    const parsed = opportunitySchema.safeParse({ product, useCase, trend, goal, budget, category, useCaseKey, targetPlatform });
    if (!parsed.success) { setError("Bitte Produktname, gültigen Link, Zielgruppe, Angaben und einen konkreten Use Case (mindestens 12 Zeichen) eintragen."); return; }
    setError("");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let latest: ContentJob | undefined;
    const execute = async () => {
      const response = await fetch("/api/content", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-content-password": password },
        body: JSON.stringify({ requestId: crypto.randomUUID(), opportunity: parsed.data, mode: "reference" }) });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Planung konnte nicht starten."); }
      if (!response.body) throw new Error("Keine Antwort vom Orchestrator erhalten.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          latest = parseJob(JSON.parse(line)); remember(latest);
        }
        if (done) break;
      }
      if (!latest || !terminalStatuses.includes(latest.status)) throw new Error("Verbindung beendet, bevor der Job abgeschlossen war.");
    };
    try {
      if (navigator.locks) await navigator.locks.request("affiliate-content-planning", { ifAvailable: true }, async lock => {
        if (!lock) throw new Error("In einem anderen Tab läuft bereits eine Planung.");
        await execute();
      });
      else await execute();
    } catch (caught) {
      const message = controller.signal.aborted ? "Planung gestoppt. Es wird nichts automatisch neu gestartet." : caught instanceof Error ? caught.message : "Planung fehlgeschlagen.";
      setError(message);
      // The database remains authoritative even when delivery to this browser fails.
      // Reload history to discover the saved state; never invent a persisted terminal state here.

    } finally { abortRef.current = null; setBusy(false); }
  }

  async function approve() {
    if (!job || job.status !== "awaiting_approval") return;
    try {
      const response=await fetch("/api/content/jobs",{method:"POST",headers:{"Content-Type":"application/json","x-content-password":password},body:JSON.stringify({action:"approve",jobId:job.id})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      remember(parseJob(data.job));
    }catch(caught){setError(caught instanceof Error?caught.message:"Freigabe konnte nicht gespeichert werden.");}
  }
  function download() {
    if (!job) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(job, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `content-job-${job.id}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="panel contentStudio" id="content-studio">
    <div className="panelTitle"><span>02</span><div><h2>Content-Planung</h2><p>Die überzeugendste Anwendung bestimmt das Format.</p></div></div>
    <p className="agentHierarchy">Creative → Orchestrator → Video, Bild oder Text → Orchestrator → Marketing</p>
    <label>Konkrete Alltagssituation / Use Case<textarea value={useCase} maxLength={1600} onChange={e => setUseCase(e.target.value)} placeholder="Zum Beispiel: Beim Familienessen staunt Oma über das rosa Steak. Papa erklärt Vakuumierer, Sous-vide-Garer und das Anbraten." /></label>
    <label>Trend oder Anlass (optional)<input value={trend} maxLength={600} onChange={e => setTrend(e.target.value)} placeholder="Welcher Anlass macht die Idee gerade relevant?" /></label>
    <div className="two">
      <label>Ziel<select value={goal} onChange={e => setGoal(e.target.value as Opportunity["goal"])}><option value="conversion">Kaufinteresse</option><option value="education">Erklären & informieren</option><option value="community">Community & Austausch</option></select></label>
      <label>Produktionsbudget<select value={budget} onChange={e => setBudget(e.target.value as Opportunity["budget"])}><option value="low">Geringer Aufwand</option><option value="balanced">Ausgewogen</option><option value="quality">Wirkung priorisieren</option></select></label>
    </div>
    <div className="two"><label>Produktkategorie<select value={category} onChange={e=>setCategory(e.target.value as Opportunity["category"])}><option value="general">Noch nicht eingeordnet</option><option value="kitchen">Küche</option><option value="household">Haushalt</option><option value="technology">Technik</option><option value="leisure">Freizeit</option></select></label>
    <label>Zielplattform<select value={targetPlatform} onChange={e=>setTargetPlatform(e.target.value as Opportunity["targetPlatform"])}><option value="any">Noch offen</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option></select></label></div>
    <label>Anwendungsgruppe für ähnliche Fälle<input value={useCaseKey} onChange={e=>setUseCaseKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,"-"))} maxLength={80} placeholder="z. B. sous-vide oder vorratshaltung" /><small>Für vergleichbare Anwendungen denselben Begriff verwenden. „general“ aktiviert noch keinen historischen Vergleich.</small></label>
    <p className="muted">Tavily recherchiert aktuelle Trends und Produktquellen. Die Content-Planung arbeitet regelbasiert ohne generative Modellkosten.</p>
    <label>Zugangscode für Planung & Datenbank<input type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} /><small>Der Code wird nicht im Browser gespeichert.</small></label>
    <p className={databaseReady ? "muted" : "error"}>{databaseReady ? "Postgres konfiguriert. Verlauf laden prüft die Verbindung." : "Postgres muss noch eingerichtet werden. Neue Jobs werden erst mit zentralem Speicher gestartet."}</p>
    <div className="contentActions"><button type="button" className="ghost" disabled={busy || !password || !databaseReady} onClick={()=>loadHistory()}>Gespeicherten Verlauf laden</button>{jobs.length >= 50 && <button type="button" className="ghost" disabled={busy} onClick={()=>loadHistory(true)}>Ältere Jobs laden</button>}</div>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="contentActions"><button type="button" className="primary" disabled={!ready || busy || !databaseReady || !password} onClick={plan}>{busy ? "Orchestrator plant …" : "Ideen & passendes Format planen"}</button>{busy && <button type="button" className="ghost" onClick={() => abortRef.current?.abort()}>Stoppen</button>}</div>
    <p className="muted">Dieser Auftrag erstellt einen Content-Plan. Medienproduktion und Veröffentlichung werden dadurch nicht gestartet.</p>
    {jobs.length > 0 && <label>Job-Verlauf<select disabled={busy} value={job?.id || ""} onChange={e => setSelectedId(e.target.value)}>{jobs.map(item => <option key={item.id} value={item.id}>{item.opportunity.product.name} · {labels[item.status]} · {new Date(item.createdAt).toLocaleString("de-DE")}</option>)}</select></label>}
    {job && <div className="contentJob">
      <div className="jobHeader"><strong aria-live="polite">{labels[job.status]}</strong><span>{job.mode === "ai" ? "Historische KI-Planung" : "Regelbasierter Entwurf"} · {job.revisions}/2 Überarbeitungen</span></div>
      <small>Job {job.id} · {job.modelCalls} externe Modellaufrufe</small>
      <p><a href={job.opportunity.product.affiliateUrl} target="_blank" rel="sponsored noopener">Geplantes Affiliate-Linkziel prüfen ↗</a></p>
      <p><b>Produkt:</b> {job.opportunity.product.name}<br /><b>Use Case:</b> {job.opportunity.useCase}</p>
      {JSON.stringify({ ...job.opportunity.product, affiliateUrl: "" }) !== JSON.stringify({ ...product, affiliateUrl: "" }) && <p className="error">Dieser Job gehört zu einem früheren Produktstand. Änderungen oben sind noch nicht eingearbeitet.</p>}
      {job.error && <p className="error">{job.error}</p>}
      {job.ideas && <div className="ideaGrid">{job.ideas.map(idea => <article className={`ideaCard ${job.decision?.ideaId === idea.id ? "selectedIdea" : ""}`} key={idea.id}>
        <small>{formatLabels[idea.format]}{job.decision?.ideaId === idea.id ? " · ausgewählt" : ""}</small><h3>{idea.title}</h3><p>{idea.hook}</p><p>{idea.story}</p><small>{idea.rationale}</small>
        {!!idea.crossSell.length && <details><summary>Zubehör & Cross-Sell</summary><ul>{idea.crossSell.map(item => <li key={item.product}><b>{item.product}</b> – {item.reason} {item.required ? "Für diese Anwendung nötig." : "Optionale Ergänzung."}</li>)}</ul></details>}
      </article>)}</div>}
      {job.decision && <div className="reviewBox"><h3>Formatentscheidung: {formatLabels[job.decision.format]}</h3><p>{job.decision.reason}</p></div>}
      {learningEvidence && <div className="marketingPlan"><h3>Historische Vergleichsfälle</h3><p>{learningEvidence.summary}</p><div style={{overflowX:"auto"}}><table><thead><tr><th>Format</th><th>Fälle</th><th>Conversion</th><th>Erlös / Kosten</th><th>Anpassung</th></tr></thead><tbody>{learningEvidence.groups.map(group=><tr key={group.format}><td>{formatLabels[group.format]}</td><td>{group.count}</td><td>{(group.conversionRate*100).toFixed(1)} %</td><td>{(group.revenueCents/100).toFixed(2)} € / {(group.costCents/100).toFixed(2)} €</td><td>{group.adjustment>0?"+":""}{group.adjustment}</td></tr>)}</tbody></table></div></div>}
      {job.content && <ContentPreview content={job.content} />}
      {job.review && <p className={job.review.passed ? "muted" : "error"}>{job.review.passed ? "Redaktionelle Vorprüfung bestanden – keine unabhängige Faktenprüfung." : `Überarbeiten: ${job.review.issues.join(" ")}`}</p>}
      {job.marketing && <div className="marketingPlan"><h3>Marketing: {job.marketing.primary}</h3><p>{job.marketing.rationale}</p><p><b>Zielgruppe:</b> {job.marketing.audience}</p><p>{job.marketing.adaptation}</p><p><b>Linkplatzierung:</b> {job.marketing.linkPlacement}</p><p>{job.marketing.conversionHypothesis}</p><p><b>Messen:</b> {job.marketing.metrics.join(" · ")}</p><ul>{job.marketing.publishingChecks.map(c => <li key={c}>{c}</li>)}</ul></div>}
      <div className="contentActions">{job.status === "awaiting_approval" && <button type="button" className="primary" onClick={approve}>Content-Plan nach Prüfung freigeben</button>}<button type="button" className="ghost" onClick={download}>Job & Protokoll herunterladen</button></div>
      {job.status === "approved" && <><p className="success">Content-Plan freigegeben. Kostenpflichtige Produktion und Veröffentlichung benötigen getrennte Freigaben.</p><ProductionGate job={job} password={password} onRevised={remember} />{job.content && job.content.format !== "video" && <PublicationGate job={job} password={password} />}</>}
      {terminalStatuses.includes(job.status) && <PerformanceEditor key={job.id} jobId={job.id} password={password} />}
      <details className="jobTrace"><summary>Entscheidungen & Agentenantworten ({job.events.length})</summary>{job.events.map(event => <article key={event.sequence}><small>{event.sequence} · {event.agent} · {new Date(event.at).toLocaleTimeString("de-DE")}</small><p>{event.message}</p>{event.data !== undefined && <details><summary>Strukturierte Antwort</summary><pre>{JSON.stringify(event.data, null, 2)}</pre></details>}</article>)}</details>
    </div>}
    <small>Postgres speichert Jobs, Entscheidungen und Messwerte zentral. Abgebrochene Jobs werden nicht automatisch neu gestartet.</small>
  </section>;
}

function ContentPreview({ content }: { content: Content }) {
  return <div className="contentPreview"><h3>{content.title}</h3><blockquote>{content.hook}</blockquote><p><b>Produktrolle:</b> {content.productIntegration}</p>
    {content.format === "video" && <><h4>Drehbuch · {content.durationSeconds} Sekunden</h4>{content.scenes.map((scene, i) => <article className="scene" key={i}><b>{scene.durationSeconds} s</b><div><strong>{scene.visual}</strong><p>{scene.audio}</p><em>{scene.overlay}</em></div></article>)}<p>{content.caption}</p><p className="muted">Mehrere Szenen mit Schnitt und Ton erforderlich. Der bisherige einzelne 10-Sekunden-Clip setzt dieses Drehbuch nicht vollständig um.</p></>}
    {content.format === "image" && <><h4>{content.layout === "carousel" ? "Carousel" : "Einzelbild"} · {content.slides.length} Motive</h4>{content.slides.map((slide, i) => <article className="slidePlan" key={i}><h4>{i + 1}. {slide.headline}</h4><p>{slide.copy}</p><p><b>Bild:</b> {slide.visual}</p><details><summary>Bildprompt & Alt-Text</summary><p>{slide.prompt}</p><p>Alt: {slide.alt}</p></details></article>)}<p>{content.caption}</p></>}
    {content.format === "text" && <div className="postCopy">{content.body}</div>}
    <p><b>CTA:</b> {content.cta}</p><p className="disclosure">{content.disclosure}</p><ul>{content.checks.map(check => <li key={check}>{check}</li>)}</ul>
  </div>;
}
