"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ArchEdge, ArchNode, ClusterId, ComponentStatus, EdgeKind } from "@/lib/architecture/model";
import type { SceneProps } from "@/app/architecture/scene";

type Payload = {
  meta: { basis: string; liveActivity: string };
  nodes: ArchNode[]; edges: ArchEdge[];
  statusMeta: Record<ComponentStatus, { label: string; color: string; description: string }>;
  clusterMeta: Record<ClusterId, { label: string; color: string }>;
  edgeMeta: Record<EdgeKind, { label: string; color: string }>;
  kindLabel: Record<string, string>;
  deployment: { id: string; label: string; state: string; missing: string[] }[];
};

// Loaded on demand and client side only: WebGL never touches server routes, and a failing 3D bundle cannot break the studio.
const Scene = dynamic(() => import("@/app/architecture/scene"), { ssr: false, loading: () => <p className="muted" role="status">3D-Szene wird geladen …</p> });

class SceneBoundary extends Component<{ children: ReactNode; onFail: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onFail(error.message || "3D-Szene konnte nicht gestartet werden."); }
  render() { return this.state.failed ? null : this.props.children; }
}

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch { return false; }
}

export function CommandCenter({ password }: { password: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hiddenEdges, setHiddenEdges] = useState<Set<EdgeKind>>(new Set());
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"architecture" | "process">("architecture");
  const [resetToken, setResetToken] = useState(0);
  const [use3d, setUse3d] = useState(true);
  const [webglSupported, setWebglSupported] = useState(false);
  const [sceneError, setSceneError] = useState("");
  const [reduced, setReduced] = useState(false);
  // The canvas is mounted once and afterwards only hidden: unmounting a react-three-fiber root inside a React commit logs
  // "synchronously unmount a root" errors with React 19. A hidden scene renders nothing (frameloop "never").
  const [sceneMounted, setSceneMounted] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [open]);

  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/architecture", { headers: { "x-content-password": password }, cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Architekturdaten nicht erreichbar.");
      setData(body as Payload);
      // Probed once per load: every probe creates a WebGL context, so it must never run during render.
      const gl = webglAvailable();
      setWebglSupported(gl);
      setUse3d(gl);
      if (gl) setSceneMounted(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Architekturdaten nicht erreichbar."); }
    finally { setLoading(false); }
  }

  const selected = data?.nodes.find(node => node.id === selectedId) ?? null;
  const highlight = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return new Set<string>();
    return new Set(data.nodes.filter(node => `${node.label} ${node.summary} ${node.responsibilities.join(" ")}`.toLowerCase().includes(q)).map(node => node.id));
  }, [query, data]);
  const links = useMemo(() => {
    if (!data || !selectedId) return { out: [] as { edge: ArchEdge; node?: ArchNode }[], inn: [] as { edge: ArchEdge; node?: ArchNode }[] };
    const find = (id: string) => data.nodes.find(node => node.id === id);
    return { out: data.edges.filter(edge => edge.from === selectedId).map(edge => ({ edge, node: find(edge.to) })), inn: data.edges.filter(edge => edge.to === selectedId).map(edge => ({ edge, node: find(edge.from) })) };
  }, [data, selectedId]);

  const toggle = <T,>(set: Set<T>, value: T) => { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next; };
  const sceneProps: SceneProps | null = data ? { nodes: data.nodes, edges: data.edges, selectedId, hiddenClusters: hidden, hiddenEdgeKinds: hiddenEdges, highlightIds: highlight, mode, reducedMotion: reduced, active: open && use3d, resetToken, onSelect: setSelectedId } : null;
  const showScene = use3d && !sceneError;

  return <>
  <div className="ccLauncher"><button type="button" className="ghost" onClick={() => { setOpen(true); if (!data) void load(); }}>Jarvis 3D Command Center öffnen</button><small>Nur Lesezugriff auf Architekturdaten. Keine Datenbank, keine Provider, kein Publishing.</small></div>
  <section className="ccRoot" hidden={!open} role="dialog" aria-modal="true" aria-label="Jarvis 3D Command Center" data-testid="command-center">
    <div className="ccHead"><div><h3>Jarvis 3D Command Center</h3><p className="muted">{data?.meta.basis}</p></div><button type="button" className="ghost" onClick={() => setOpen(false)}>Schließen (Esc)</button></div>
    {loading && <p role="status" className="muted">Architekturdaten werden geladen …</p>}
    {error && <p role="alert" className="error">{error} {password ? "" : "Bitte zuerst den Zugangscode eintragen."} <button type="button" className="ghost" onClick={() => void load()}>Erneut versuchen</button></p>}
    {data && <>
      <p className="ccNotice">{data.meta.liveActivity}</p>
      {(!use3d || sceneError) && <p role="status" className="muted" data-testid="cc-fallback-note">{sceneError ? `3D-Szene nicht verfügbar (${sceneError}). ` : webglSupported ? "" : "WebGL wird von diesem Browser nicht unterstützt. "}2D-Ansicht aktiv – alle Informationen bleiben verfügbar.</p>}
      <div className="ccToolbar">
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Komponente suchen …" aria-label="Komponente suchen" />
        <div role="group" aria-label="Ansicht"><button type="button" className={mode === "architecture" ? "primary" : "ghost"} aria-pressed={mode === "architecture"} onClick={() => setMode("architecture")}>Architektur</button><button type="button" className={mode === "process" ? "primary" : "ghost"} aria-pressed={mode === "process"} onClick={() => setMode("process")}>Prozess (dekorativ animiert)</button></div>
        <button type="button" className="ghost" onClick={() => { setSelectedId(null); setQuery(""); setHidden(new Set()); setHiddenEdges(new Set()); setResetToken(token => token + 1); }}>Gesamtansicht</button>
        {use3d && <button type="button" className="ghost" onClick={() => setUse3d(false)}>2D-Ansicht</button>}
        {!use3d && webglSupported && <button type="button" className="ghost" onClick={() => { setSceneError(""); setUse3d(true); setSceneMounted(true); }}>3D-Ansicht</button>}
      </div>
      <div className="ccChips" role="group" aria-label="Cluster ein-/ausblenden">{(Object.keys(data.clusterMeta) as ClusterId[]).map(id => <button key={id} type="button" aria-pressed={!hidden.has(id)} className={`ccChip ${hidden.has(id) ? "ccChipOff" : ""}`} style={{ borderColor: data.clusterMeta[id].color }} onClick={() => setHidden(toggle(hidden, id))}>{data.clusterMeta[id].label}</button>)}</div>
      <div className="ccBody">
        <div className="ccStage" data-testid="cc-stage">
          {sceneMounted && !sceneError && sceneProps && <div style={{ height: "100%", display: showScene ? "block" : "none" }}><SceneBoundary onFail={setSceneError}><Scene {...sceneProps} /></SceneBoundary></div>}
          {!showScene && <div className="ccList" data-testid="cc-2d">{(Object.keys(data.clusterMeta) as ClusterId[]).filter(id => !hidden.has(id)).map(id => <div key={id}><h4 style={{ color: data.clusterMeta[id].color }}>{data.clusterMeta[id].label}</h4>
            <ul>{data.nodes.filter(node => node.cluster === id && (!highlight.size || highlight.has(node.id))).map(node => <li key={node.id}><button type="button" className={`ccRow ${node.id === selectedId ? "ccRowOn" : ""}`} onClick={() => setSelectedId(node.id)}><i style={{ background: data.statusMeta[node.status].color }} aria-hidden />{node.label}<small>{data.statusMeta[node.status].label}</small></button></li>)}</ul></div>)}</div>}
          <p className="ccHint">{showScene ? "Ziehen = drehen · Mausrad/Pinch = Zoom · Knoten anklicken = Details · Leerraum = Auswahl aufheben" : ""}</p>
        </div>
        <aside className="ccDetail" aria-live="polite" data-testid="cc-detail">
          {!selected && <><h4>Legende</h4><ul className="ccLegend">{(Object.keys(data.statusMeta) as ComponentStatus[]).map(id => <li key={id}><i style={{ background: data.statusMeta[id].color }} aria-hidden /><b>{data.statusMeta[id].label}</b><small>{data.statusMeta[id].description}</small></li>)}</ul>
            <h4>Verbindungen</h4><div className="ccEdgeChips">{(Object.keys(data.edgeMeta) as EdgeKind[]).map(id => <button key={id} type="button" aria-pressed={!hiddenEdges.has(id)} className={`ccChip ${hiddenEdges.has(id) ? "ccChipOff" : ""}`} style={{ borderColor: data.edgeMeta[id].color }} onClick={() => setHiddenEdges(toggle(hiddenEdges, id))}>{data.edgeMeta[id].label}</button>)}</div>
            <p className="muted">Form: Kugel = Orchestrator · Oktaeder = Spezialagent · Würfel = internes Modul · Zylinder = Provider · Ring = Plattform · Ikosaeder = Schranke · Tetraeder = externer Dienst. Drahtgitter = geplant.</p>
            <h4>Zugänge dieses Deployments</h4><ul className="ccDeploy">{data.deployment.filter(item => item.missing.length).slice(0, 12).map(item => <li key={item.id}><b>{item.label}</b><small>{item.state === "nicht_aktiviert" ? "nicht aktiviert" : `fehlt: ${item.missing.join(", ")}`}</small></li>)}</ul></>}
          {selected && <>
            <button type="button" className="ghost" onClick={() => setSelectedId(null)}>← Zurück zur Gesamtansicht</button>
            <h4>{selected.label}</h4>
            <p><span className="ccBadge" style={{ background: data.statusMeta[selected.status].color }}>{data.statusMeta[selected.status].label}</span> <small>{data.kindLabel[selected.kind]} · {data.clusterMeta[selected.cluster].label}</small></p>
            <p>{selected.summary}</p>
            {!!selected.responsibilities.length && <><b>Verantwortlichkeiten</b><ul>{selected.responsibilities.map(item => <li key={item}>{item}</li>)}</ul></>}
            <b>Abhängigkeiten</b>
            <ul>{links.out.map(({ edge, node }) => <li key={edge.id}>→ <button type="button" className="ccLink" onClick={() => setSelectedId(edge.to)}>{node?.label}</button> <small>({data.edgeMeta[edge.kind].label}: {edge.label})</small></li>)}{links.inn.map(({ edge, node }) => <li key={edge.id}>← <button type="button" className="ccLink" onClick={() => setSelectedId(edge.from)}>{node?.label}</button> <small>({data.edgeMeta[edge.kind].label}: {edge.label})</small></li>)}</ul>
            {!!selected.gaps.length && <><b>Offene Punkte</b><ul>{selected.gaps.map(item => <li key={item}>{item}</li>)}</ul></>}
            <details><summary>Code &amp; Tests</summary><ul>{selected.code.map(item => <li key={item}><code>{item}</code></li>)}{selected.tests.map(item => <li key={item}><code>{item}</code> <small>Test</small></li>)}</ul></details>
            {selected.env && <details><summary>Umgebungsvariablen (nur Namen)</summary><ul>{selected.env.map(item => <li key={item}><code>{item}</code></li>)}</ul></details>}
          </>}
        </aside>
      </div>
    </>}
  </section>
  </>;
}
