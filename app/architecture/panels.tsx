"use client";

import type { ClusterId, OperationalStatus } from "@/lib/architecture/model";
import type { ClientNode, Payload, Selection } from "@/app/architecture/types";

// Panels of the Command Center (DOM, accessible, shared by the 3D and the 2D view). Pure presentation of the payload.

const time = (iso: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const ENV_LABEL: Record<string, string> = { production: "Production", preview: "Preview", development: "Entwicklung", local: "Lokal" };
const STATUS_ORDER: OperationalStatus[] = ["error", "not_configured", "unknown", "active", "ready", "disabled", "not_applicable"];

export function OpChip({ data, status, compact }: { data: Payload; status: OperationalStatus; compact?: boolean }) {
  const meta = data.labels.operation[status];
  return <span className={`ccOp ${compact ? "ccOpCompact" : ""}`} title={meta.description}><i style={{ background: meta.color }} aria-hidden />{meta.label}</span>;
}

export function StatusRows({ data, node }: { data: Payload; node: ClientNode }) {
  const op = data.runtime.nodes[node.id];
  return <dl className="ccStatusRows">
    <div><dt>Umsetzung</dt><dd title={data.labels.implementation[node.implementation].description}>{data.labels.implementation[node.implementation].label}</dd></div>
    <div><dt>Deployment</dt><dd title={data.labels.deployment[node.deployment].description}>{data.labels.deployment[node.deployment].label}</dd></div>
    <div><dt>Betrieb</dt><dd>{op ? <OpChip data={data} status={op.status} /> : "–"}</dd></div>
    {op && <p className="ccReason">{op.reason}<small> · Quelle: {op.source}{op.source === "Datenbank" ? `, Stand ${time(data.runtime.evidence.generatedAt)}` : op.source === "Konfiguration" || op.source === "Preview-Sperre" ? `, Stand ${time(data.runtime.generatedAt)}` : ""}</small></p>}
  </dl>;
}

export function countByStatus(data: Payload, nodes: ClientNode[]) {
  const counts = new Map<OperationalStatus, number>();
  for (const node of nodes) { const status = data.runtime.nodes[node.id]?.status ?? "unknown"; counts.set(status, (counts.get(status) ?? 0) + 1); }
  return STATUS_ORDER.filter(status => counts.get(status)).map(status => ({ status, count: counts.get(status)! }));
}

export function StatusSummary({ data, nodes }: { data: Payload; nodes: ClientNode[] }) {
  return <span className="ccSummary">{countByStatus(data, nodes).map(item => <span key={item.status} className="ccSummaryItem" title={data.labels.operation[item.status].description}>
    <i style={{ background: data.labels.operation[item.status].color }} aria-hidden />{item.count} {data.labels.operation[item.status].label}</span>)}</span>;
}

function NodeLink({ data, id, onSelect }: { data: Payload; id: string; onSelect: (selection: Selection) => void }) {
  const node = data.nodes.find(item => item.id === id);
  if (!node) return null;
  const status = data.runtime.nodes[id]?.status;
  return <button type="button" className="ccLink" onClick={() => onSelect(node.cluster === "core" ? { type: "jarvis" } : { type: "node", id })}>
    {node.label}{status && <span className="ccLinkStatus" style={{ color: data.labels.operation[status].color }}> · {data.labels.operation[status].label}</span>}</button>;
}

export function NodePanel({ data, node, onSelect }: { data: Payload; node: ClientNode; onSelect: (selection: Selection) => void }) {
  const out = data.edges.filter(edge => edge.from === node.id);
  const inn = data.edges.filter(edge => edge.to === node.id);
  const op = data.runtime.nodes[node.id];
  const cluster = node.cluster === "core" ? null : node.cluster;
  return <>
    <div className="ccCrumbs">
      <button type="button" className="ccLink" onClick={() => onSelect(null)}>Gesamtübersicht</button>
      {cluster && <> › <button type="button" className="ccLink" onClick={() => onSelect({ type: "cluster", id: cluster })}>{data.labels.clusters[cluster].label}</button></>}
    </div>
    <h4 className="ccTitle">{node.label}</h4>
    <p className="muted ccKind">{data.labels.kinds[node.kind]}</p>
    <p className="ccPlain">{node.plain}</p>
    <StatusRows data={data} node={node} />
    {!!op?.details.length && <ul className="ccDetails">{op.details.map(item => <li key={item}>{item}</li>)}</ul>}
    {node.proof && <p className="ccProof"><b>Dokumentierter Nachweis:</b> {node.proof} <small>(Repo-Dokumentation, vom Command Center nicht gemessen)</small></p>}
    {!!node.responsibilities.length && <><h5>Aufgaben</h5><ul>{node.responsibilities.map(item => <li key={item}>{item}</li>)}</ul></>}
    {(!!out.length || !!inn.length) && <><h5>Zusammenarbeit</h5><ul className="ccRelations">
      {inn.map(edge => <li key={edge.id}><span aria-hidden>←</span> <NodeLink data={data} id={edge.from} onSelect={onSelect} /> <small>{edge.label}{edge.planned ? " (geplant)" : ""}</small></li>)}
      {out.map(edge => <li key={edge.id}><span aria-hidden>→</span> <NodeLink data={data} id={edge.to} onSelect={onSelect} /> <small>{edge.label}{edge.planned ? " (geplant)" : ""}</small></li>)}
    </ul></>}
    {!!node.gaps.length && <><h5>Offene Punkte</h5><ul>{node.gaps.map(item => <li key={item}>{item}</li>)}</ul></>}
    <details className="ccTech"><summary>Technische Details</summary>
      <p>{node.summary}</p>
      <ul>{node.code.map(item => <li key={item}><code>{item}</code></li>)}{node.tests.map(item => <li key={item}><code>{item}</code> <small>Test</small></li>)}</ul>
      {node.env && <><b>Variablen (nur Namen)</b><ul>{node.env.map(item => <li key={item}><code>{item}</code></li>)}</ul></>}
    </details>
  </>;
}

export function ClusterPanel({ data, cluster, onSelect }: { data: Payload; cluster: ClusterId; onSelect: (selection: Selection) => void }) {
  const meta = data.labels.clusters[cluster];
  const members = data.nodes.filter(node => node.cluster === cluster);
  return <>
    <div className="ccCrumbs"><button type="button" className="ccLink" onClick={() => onSelect(null)}>Gesamtübersicht</button></div>
    <h4 className="ccTitle" style={{ color: meta.color }}>{meta.label}</h4>
    <p className="ccPlain">{meta.plain}</p>
    <StatusSummary data={data} nodes={members} />
    <ul className="ccMembers">{members.map(node => <li key={node.id}>
      <button type="button" className="ccMember" onClick={() => onSelect({ type: "node", id: node.id })}>
        <span className="ccMemberName">{node.label}</span><OpChip data={data} status={data.runtime.nodes[node.id]?.status ?? "unknown"} compact />
        <small>{node.plain}</small>
      </button></li>)}</ul>
  </>;
}

export function OverviewPanel({ data, onSelect }: { data: Payload; onSelect: (selection: Selection) => void }) {
  const rt = data.runtime;
  const attention = data.nodes.filter(node => ["error", "not_configured"].includes(rt.nodes[node.id]?.status ?? ""));
  const jarvis = data.nodes.find(node => node.cluster === "core");
  return <>
    <h4 className="ccTitle">Gesamtübersicht</h4>
    <p className="ccPlain">{jarvis?.plain}</p>
    <p className="ccEnv"><b>Umgebung:</b> {ENV_LABEL[rt.environment] ?? rt.environment}{rt.sandbox ? " (Sandbox erklärt)" : ""} · <b>Stand:</b> {time(rt.generatedAt)}</p>
    <p className={`ccEvidence ${rt.evidence.available ? "" : "ccEvidenceOff"}`}>{rt.evidence.available
      ? `Laufzeitdaten: aus der Datenbank (nur lesend), Stand ${time(rt.evidence.generatedAt)}.`
      : `Keine Laufzeitdaten: ${rt.evidence.reason ?? "nicht verfügbar"}. Status beruht auf Konfiguration und Repo-Analyse.`}</p>
    <h5>Alle Komponenten</h5>
    <StatusSummary data={data} nodes={data.nodes} />
    {!!attention.length && <><h5>Braucht Aufmerksamkeit</h5><ul className="ccRelations">{attention.map(node => <li key={node.id}><NodeLink data={data} id={node.id} onSelect={onSelect} /> <small>{rt.nodes[node.id]?.reason}</small></li>)}</ul></>}
    {!!rt.pending.length && <><h5>Wartet auf deine Freigabe</h5><ul>{rt.pending.map(item => <li key={item.label}>{item.label}: <b>{item.count}</b></li>)}</ul></>}
    {!!rt.publications.length && <><h5>Letzte Veröffentlichungsversuche</h5><ul className="ccPubs">{rt.publications.slice(0, 8).map((item, index) => <li key={`${item.platform}-${item.at}-${index}`}>
      <b>{item.platform}</b> · {item.status === "published" ? "veröffentlicht" : item.status === "processing" ? "in Verarbeitung" : item.status === "failed" ? "fehlgeschlagen" : "unklar"} · {time(item.at)}
      {item.url && <> · <a href={item.url} target="_blank" rel="noopener noreferrer">Beitrag öffnen</a></>}</li>)}</ul></>}
    <h5>Schalter</h5>
    <ul className="ccFlags">
      <li>Themen-Pipeline: <b>{rt.flags.topicPipeline ? "an" : "aus"}</b></li>
      <li>Live-Veröffentlichung (Themen): <b>{rt.flags.livePublishing ? "an" : "aus – nur Probelauf"}</b></li>
      <li>Trendsetter ↔ Affiliate: <b>{rt.flags.trendsetterAffiliate}</b></li>
      <li>Themenbeiträge pro Tag: <b>{rt.flags.topicPostsPerDay}</b></li>
      <li>Bild-Qualitätsprüfung: <b>{rt.flags.qualityGate}</b></li>
    </ul>
    {!!data.missing.length && <details className="ccTech"><summary>Fehlende Zugänge dieses Deployments (nur Namen)</summary>
      <ul>{data.missing.map(item => <li key={item.id}><b>{item.label}</b> – {item.state === "nicht_aktiviert" ? "nicht aktiviert" : item.missing.join(", ")}</li>)}</ul></details>}
    <Legend data={data} />
  </>;
}

export function Legend({ data }: { data: Payload }) {
  return <details className="ccTech"><summary>Legende</summary>
    <ul className="ccLegend">{STATUS_ORDER.map(status => <li key={status}><i style={{ background: data.labels.operation[status].color }} aria-hidden /><b>{data.labels.operation[status].label}</b><small>{data.labels.operation[status].description}</small></li>)}</ul>
    <p className="muted">Farbe = Betriebsstatus, immer zusätzlich als Text. Form: Kugel Orchestrator · Oktaeder Agent · Würfel Modul · Zylinder Anbieter · Ring Plattform · Ikosaeder Prüfschranke · Tetraeder externer Dienst · Drahtgitter geplant. Große Kugeln = Hauptbereiche.</p>
  </details>;
}

export function ProcessRibbon({ data, onSelect }: { data: Payload; onSelect: (selection: Selection) => void }) {
  const rt = data.runtime;
  return <section className="ccProcess" aria-label="Ablauf eines Themenbeitrags">
    <p className={`ccEvidence ${rt.evidence.available ? "" : "ccEvidenceOff"}`}>{rt.evidence.available
      ? `Ablauf mit Zahlen aus der Datenbank (Stand ${time(rt.evidence.generatedAt)}). Bewegungen in der 3D-Szene sind Darstellung, keine Echtzeit-Verfolgung.`
      : "Architekturdarstellung: zeigt den vorgesehenen Ablauf. Es liegen keine Live-Auftragsdaten vor."}</p>
    <ol className="ccSteps">{data.process.map((step, index) => {
      const state = rt.steps.find(item => item.id === step.id);
      return <li key={step.id}><button type="button" className="ccStep" onClick={() => {
        const first = data.nodes.find(node => node.id === step.nodes[0]);
        if (first) onSelect(first.cluster === "core" ? { type: "jarvis" } : { type: "node", id: first.id });
      }}>
        <span className="ccStepNo">{index + 1}</span><b>{step.label}</b>
        {state && <OpChip data={data} status={state.status} compact />}
        <small>{step.plain}</small>
        {!!state?.counts.length && <small className="ccStepCounts">{state.counts.join(" · ")}</small>}
      </button></li>;
    })}</ol>
  </section>;
}

export function GroupedView({ data, selection, query, onSelect }: { data: Payload; selection: Selection; query: string; onSelect: (selection: Selection) => void }) {
  const q = query.trim().toLowerCase();
  const match = (node: ClientNode) => !q || `${node.label} ${node.plain} ${node.summary}`.toLowerCase().includes(q);
  const clusters = (Object.keys(data.labels.clusters) as ClusterId[]).sort((a, b) => data.labels.clusters[a].order - data.labels.clusters[b].order);
  const selectedNode = selection?.type === "node" ? data.nodes.find(node => node.id === selection.id) : null;
  const openCluster = selection?.type === "cluster" ? selection.id : selectedNode && selectedNode.cluster !== "core" ? selectedNode.cluster : null;
  const jarvis = data.nodes.find(node => node.cluster === "core");
  return <div className="ccGrouped" data-testid="cc-2d">
    {jarvis && <button type="button" className={`ccJarvisCard ${selection?.type === "jarvis" ? "ccCardOn" : ""}`} onClick={() => onSelect({ type: "jarvis" })}>
      <b>JARVIS</b><OpChip data={data} status={data.runtime.nodes[jarvis.id]?.status ?? "unknown"} compact /><small>{jarvis.plain}</small></button>}
    {clusters.map(cluster => {
      const members = data.nodes.filter(node => node.cluster === cluster && match(node));
      if (!members.length) return null;
      const meta = data.labels.clusters[cluster];
      return <details key={cluster} className="ccGroup" open={!!q || openCluster === cluster} style={{ borderColor: meta.color }}>
        <summary><span className="ccGroupTitle" style={{ color: meta.color }}>{meta.label}</span><StatusSummary data={data} nodes={members} /><small>{meta.plain}</small></summary>
        <div className="ccCards">{members.map(node => <button key={node.id} type="button" className={`ccCard ${selectedNode?.id === node.id ? "ccCardOn" : ""}`} onClick={() => onSelect({ type: "node", id: node.id })}>
          <span className="ccCardHead"><b>{node.label}</b><OpChip data={data} status={data.runtime.nodes[node.id]?.status ?? "unknown"} compact /></span>
          <small>{node.plain}</small>
          <small className="muted">{data.labels.implementation[node.implementation].label} · {data.labels.deployment[node.deployment].label}</small>
        </button>)}</div>
      </details>;
    })}
  </div>;
}
