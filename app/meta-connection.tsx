"use client";
import {useState} from "react";
import type {publicMetaReport} from "@/lib/meta/connection";
type Report=ReturnType<typeof publicMetaReport>&{pagePublishing:{status:string;source:string;httpStatus?:number;code?:number;subcode?:number}};
export function MetaConnection(){
  const [report,setReport]=useState<Report|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  async function check(){setBusy(true);setError("");try{
    const response=await fetch("/api/meta/connection",{cache:"no-store"});
    if(!response.ok)throw new Error("Verbindungstest derzeit nicht erreichbar.");
    setReport(await response.json());
  }catch(caught){setError(caught instanceof Error?caught.message:"Verbindungstest fehlgeschlagen.");}finally{setBusy(false);}}
  return <section className="panel" style={{marginBottom:24}}><div className="panelTitle"><span>↗</span><div><h2>Meta-Verbindung</h2><p>Alltäglich leichter · Instagram @alltaeglich.leichter</p></div></div>
    <button type="button" className="secondary" disabled={busy} onClick={check}>{busy?"Zugriff wird geprüft …":"Facebook & Instagram prüfen"}</button>
    <p>Lesender Verbindungstest. Es werden keine Beiträge oder Video-Container erstellt.</p>
    {error && <p role="alert" className="error">{error}</p>}
    {report && <div className={report.status==="connected"?"reviewBox":"error"} role="status"><strong>{report.status==="connected"?"Verbindung bestätigt":`Diagnose: ${report.status}`}</strong><p>{report.message}</p>
      <small>Geprüft: {new Date(report.checkedAt).toLocaleString("de-DE")} · Ergebnis maximal zwei Minuten zwischengespeichert.</small>
      <p>Server-Token: {report.configured.token?"vorhanden":"fehlt"} · Facebook-ID: {report.pageIdResolved?"ermittelt":"noch offen"} · Instagram-ID: {report.instagramIdResolved?"ermittelt":"noch offen"}</p>
      <p>Facebook-Foto-Freigabe: {report.pagePublishing.status==="ready"?`Page-Token geprüft (${report.pagePublishing.source==="derived"?"aus Systemnutzer abgeleitet":"konfiguriert"})`:`Page-Token ${report.pagePublishing.status}; vor einem neuen Veröffentlichungsversuch beheben.`}</p>
      {!!report.missingPermissions.length && <p>Fehlende Berechtigungen: {report.missingPermissions.join(", ")}</p>}
      <p>Automatisches Publishing ist weiterhin deaktiviert.</p>
    </div>}
  </section>;
}
