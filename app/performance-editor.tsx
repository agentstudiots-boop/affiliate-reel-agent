"use client";
import { useState } from "react";
import { performanceSchema, type PerformanceInput } from "@/lib/memory/schema";

export function PerformanceEditor({ jobId, password }: { jobId: string; password: string }) {
  const [platform,setPlatform]=useState<"facebook"|"instagram">("facebook");
  const [status,setStatus]=useState<PerformanceInput["status"]>("draft");
  const [url,setUrl]=useState(""); const [publishedAt,setPublishedAt]=useState("");
  const [clicks,setClicks]=useState("0"); const [conversions,setConversions]=useState("0");
  const [revenue,setRevenue]=useState("0"); const [cost,setCost]=useState("");
  const [windowDays,setWindowDays]=useState<14|30|60>(30);const [finalized,setFinalized]=useState(false);
  const [source,setSource]=useState(""); const [learning,setLearning]=useState("");
  const [revision,setRevision]=useState(0);const [loaded,setLoaded]=useState(false);
  const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);
  const [result,setResult]=useState<{profit: number|null;roi:number|null}|null>(null);
  async function load() {
    setBusy(true);setMessage("");setLoaded(false);
    try {
      const response=await fetch(`/api/content/jobs?jobId=${jobId}`,{headers:{"x-content-password":password}});
      const data=await response.json(); if(!response.ok)throw new Error(data.error);
      const row=data.performance.find((r:{platform:string})=>r.platform===platform);
      setStatus(row?.status || "draft");setUrl(row?.url || "");setPublishedAt(row?.published_at?.slice(0,16)||"");
      setClicks(String(row?.clicks ?? 0));setConversions(String(row?.conversions ?? 0));
      setRevenue(String(Number(row?.affiliate_revenue_cents || 0)/100));setCost(row?.production_cost_cents == null ? "" : String(Number(row.production_cost_cents)/100));
      setWindowDays(Number(row?.window_days || 30) as 14|30|60);setFinalized(row?.finalized===true);
      setSource(row?.source||"");setLearning(row?.learning||"");setRevision(Number(row?.revision||0));
      setResult(row ? {profit:row.profit_cents==null?null:Number(row.profit_cents)/100,roi:row.roi==null?null:Number(row.roi)} : null);setLoaded(true);
    } catch(error){setMessage(error instanceof Error?error.message:"Laden fehlgeschlagen.");}
    finally{setBusy(false);}
  }
  async function save() {
    setMessage("");
    const parsed=performanceSchema.safeParse({jobId,platform,status,url,publishedAt:publishedAt?`${publishedAt}:00.000Z`:"",windowDays,finalized,
      clicks:Number(clicks),conversions:Number(conversions),revenueCents:Math.round(Number(revenue)*100),costCents:cost.trim()===""?null:Math.round(Number(cost)*100),source,learning,expectedRevision:revision});
    if(!parsed.success){setMessage(parsed.error.issues.map(i=>i.message).join(" "));return;}
    setBusy(true);
    try {
      const response=await fetch("/api/content/jobs",{method:"POST",headers:{"Content-Type":"application/json","x-content-password":password},body:JSON.stringify({action:"performance",data:parsed.data})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      setRevision(Number(data.result.revision));setResult({profit:data.result.profit_cents==null?null:Number(data.result.profit_cents)/100,roi:data.result.roi==null?null:Number(data.result.roi)});
      setMessage("In Postgres gespeichert. Vorherige Messstände bleiben nachvollziehbar.");
    }catch(error){setMessage(error instanceof Error?error.message:"Speichern fehlgeschlagen.");}finally{setBusy(false);}
  }
  return <section className="marketingPlan"><h3>Veröffentlichung & gemessene Ergebnisse</h3>
    <p>Gesamtwerte für das gewählte Messfenster eintragen, keine Tageszuwächse. Der letzte Stand ersetzt die Auswertungsbasis; alte Stände werden nicht addiert.</p>
    <label>Veröffentlichungsplattform<select value={platform} onChange={e=>{setPlatform(e.target.value as "facebook"|"instagram");setLoaded(false);setMessage("");}}><option value="facebook">Facebook</option><option value="instagram">Instagram</option></select></label>
    <button type="button" className="ghost" disabled={busy||!password} onClick={load}>Messwerte laden</button>
    {loaded && <>
      <label>Status<select value={status} onChange={e=>setStatus(e.target.value as PerformanceInput["status"])}><option value="draft">Noch nicht veröffentlicht</option><option value="published">Veröffentlicht</option><option value="archived">Archiviert</option></select></label>
      <label>Veröffentlichungslink<input type="url" value={url} onChange={e=>setUrl(e.target.value)} /></label>
      <label>Veröffentlicht am (UTC)<input type="datetime-local" value={publishedAt} onChange={e=>setPublishedAt(e.target.value)} /></label>
      <div className="two"><label>Klicks<input type="number" min="0" value={clicks} onChange={e=>setClicks(e.target.value)} /></label><label>Conversions / Verkäufe<input type="number" min="0" value={conversions} onChange={e=>setConversions(e.target.value)} /></label></div>
      <div className="two"><label>Affiliate-Erlös (€)<input type="number" min="0" step="0.01" value={revenue} onChange={e=>setRevenue(e.target.value)} /></label><label>Zugerechnete Produktionskosten (€)<input type="number" min="0" step="0.01" value={cost} onChange={e=>setCost(e.target.value)} placeholder="Leer = noch unbekannt" /></label></div>
      <small>Alle zurechenbaren Modell-, Medien- und Produktionskosten berücksichtigen. Bei mehreren Plattformen Kosten aufteilen. Unbekannte Kosten werden nicht als null Euro gewertet.</small>
      <label>Messfenster ab Veröffentlichung<select value={windowDays} onChange={e=>setWindowDays(Number(e.target.value) as 14|30|60)}><option value={14}>14 Tage</option><option value={30}>30 Tage · Basis für Lernen</option><option value={60}>60 Tage</option></select></label>
      <label><input type="checkbox" checked={finalized} onChange={e=>setFinalized(e.target.checked)} /> Messfenster abgeschlossen; Werte für diesen Zeitraum geprüft</label>
      <label>Herkunft / Zuordnung der Zahlen<input value={source} onChange={e=>setSource(e.target.value)} placeholder="z. B. PartnerNet-Bericht mit zugeordnetem Tracking-Link" /></label>
      <label>Auswertung / Learning<textarea value={learning} maxLength={2400} onChange={e=>setLearning(e.target.value)} placeholder="Was fiel auf? Welche Einschränkungen hat die Messung?" /></label>
      <button type="button" className="primary" disabled={busy} onClick={save}>Ergebnisse in Postgres speichern</button>
      {result && <p>Deckungsbeitrag: {result.profit===null?"Kosten fehlen":`${result.profit.toFixed(2)} €`} · ROI: {result.roi===null?"nicht definiert":`${(result.roi*100).toFixed(1)} %`}</p>}
      <small>Erlös minus zugerechnete Produktionskosten; kein vollständiger Unternehmensgewinn. Bei null Euro Kosten ist ROI nicht definiert.</small>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
