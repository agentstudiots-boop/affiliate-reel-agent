"use client";
import {useCallback,useEffect,useState} from "react";
import type {ContentJob} from "@/lib/content/schema";
import {facebookPagePublicationError} from "@/lib/meta/publication-eligibility";

type Publication={id:string;status:string;caption:string;imageUrl:string|null;permalink:string|null;feedback:string};
export function PublicationGate({job,password}:{job:ContentJob;password:string}){
  const eligibilityError=facebookPagePublicationError(job);
  const [record,setRecord]=useState<Publication|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const refresh=useCallback(async()=>{
    if(!password)return;
    const response=await fetch(`/api/publication?jobId=${encodeURIComponent(job.id)}`,{headers:{"x-content-password":password},cache:"no-store"});
    if(response.ok)setRecord((await response.json()).publication);
  },[job.id,password]);
  useEffect(()=>{const initial=setTimeout(()=>{void refresh()},0);const timer=setInterval(()=>{void refresh()},15000);return()=>{clearTimeout(initial);clearInterval(timer)}},[refresh]);
  async function request(){if(eligibilityError)return;setBusy(true);setError("");setNotice("");try{
    const response=await fetch("/api/publication",{method:"POST",headers:{"Content-Type":"application/json","x-content-password":password},body:JSON.stringify({jobId:job.id})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||"Veröffentlichungsfreigabe fehlgeschlagen.");
    setRecord(data.publication);
    setNotice(data.whatsapp==="approved_template_required"?"Entwurf gespeichert. Für WhatsApp außerhalb des 24-Stunden-Fensters fehlt eine genehmigte Meta-Vorlage.":data.approvalSent?"WhatsApp-Freigabe versendet. Nur deine ausdrückliche Antwort veröffentlicht genau einmal.":"Status aktualisiert.");
  }catch(caught){setError(caught instanceof Error?caught.message:"Anfrage fehlgeschlagen.")}finally{setBusy(false)}}
  return <section className="reviewBox"><h3>Facebook-Beitrag · separate Freigabe</h3>
    <p>Ausgewählter Job: {job.opportunity.product.name} · {job.marketing?.primary || "Marketingplan fehlt"}.</p>
    {eligibilityError?<p role="status">{eligibilityError} Der gespeicherte Job wird durch Änderungen am Formular oben nicht geändert.</p>:<p>Das System erstellt eine eigene Textgrafik aus dem freigegebenen Inhalt und sendet Beitrag und Bild zur WhatsApp-Freigabe. Nach „Freigeben“ versucht es die Veröffentlichung genau einmal.</p>}
    {!record&&!eligibilityError&&<button type="button" disabled={busy||!password} onClick={request}>{busy?"Vorbereitung läuft …":"Beitrag vorbereiten & WhatsApp-Freigabe anfragen"}</button>}
    {record&&<><p>Status: <strong>{record.status}</strong></p>{record.imageUrl&&<a href={record.imageUrl} target="_blank" rel="noopener noreferrer">Grafik prüfen ↗</a>}
      <div className="postCopy">{record.caption}</div>
      {record.status==="pending"&&!eligibilityError&&<button type="button" disabled={busy} onClick={request}>{busy?"Bitte warten …":"WhatsApp-Freigabe senden / Status prüfen"}</button>}
      {record.permalink&&<p><a href={record.permalink} target="_blank" rel="noopener noreferrer">Veröffentlichten Beitrag öffnen ↗</a></p>}
      {record.feedback&&<p>Änderungswunsch: {record.feedback}</p>}</>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
    <small>Bei unklarem Meta-Ergebnis bleibt der Status gesperrt. Es erfolgt kein zweiter Post.</small>
  </section>;
}
