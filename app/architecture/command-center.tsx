"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { ClusterId } from "@/lib/architecture/model";
import type { SceneProps } from "@/app/architecture/scene";
import { ClusterPanel, GroupedView, NodePanel, OverviewPanel, ProcessRibbon } from "@/app/architecture/panels";
import type { Hover, Payload, Selection } from "@/app/architecture/types";

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
  const [selection, setSelection] = useState<Selection>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"architecture" | "process">("architecture");
  const [resetToken, setResetToken] = useState(0);
  const [use3d, setUse3d] = useState(true);
  const [webglSupported, setWebglSupported] = useState(false);
  const [sceneError, setSceneError] = useState("");
  const [reduced, setReduced] = useState(false);
  const [hover, setHover] = useState<Hover>(null);
  // The canvas is mounted once and afterwards only hidden: unmounting a react-three-fiber root inside a React commit logs
  // "synchronously unmount a root" errors with React 19. A hidden scene renders nothing (frameloop "never").
  const [sceneMounted, setSceneMounted] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Escape goes one level up (component → area → overview); only from the overview it closes the dialog.
  const up = () => setSelection(current => {
    if (!current) { setOpen(false); return null; }
    if (current.type === "node" && data) {
      const node = data.nodes.find(item => item.id === current.id);
      return node && node.cluster !== "core" ? { type: "cluster", id: node.cluster } : null;
    }
    return null;
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); up(); } };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, data]);

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

  const clusters = useMemo(() => data ? (Object.keys(data.labels.clusters) as ClusterId[]).sort((a, b) => data.labels.clusters[a].order - data.labels.clusters[b].order) : [], [data]);
  const selectedNode = data && selection?.type === "node" ? data.nodes.find(node => node.id === selection.id) ?? null : null;
  const expanded: ClusterId | null = selection?.type === "cluster" ? selection.id : selectedNode && selectedNode.cluster !== "core" ? selectedNode.cluster : null;
  const highlight = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return new Set<string>();
    return new Set(data.nodes.filter(node => node.cluster !== "core" && `${node.label} ${node.plain} ${node.summary}`.toLowerCase().includes(q)).map(node => node.id));
  }, [query, data]);

  // Keyboard control of the 3D stage: ←/→ areas or components, Enter/↓ open, ↑ back, Home overview.
  function onStageKey(event: ReactKeyboardEvent) {
    if (!data) return;
    const members = expanded ? data.nodes.filter(node => node.cluster === expanded) : [];
    const cycle = <T,>(items: T[], current: T | undefined, step: number) => items[((current === undefined ? -1 : items.indexOf(current)) + step + items.length) % items.length];
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      if (selectedNode && members.length) setSelection({ type: "node", id: cycle(members.map(node => node.id), selectedNode.id, step) });
      else setSelection({ type: "cluster", id: cycle(clusters, expanded ?? undefined, step) });
    } else if ((event.key === "Enter" || event.key === "ArrowDown") && expanded && !selectedNode && members.length) {
      event.preventDefault(); setSelection({ type: "node", id: members[0].id });
    } else if (event.key === "Enter" && !expanded) {
      event.preventDefault(); setSelection({ type: "jarvis" });
    } else if (event.key === "ArrowUp") { event.preventDefault(); up(); }
    else if (event.key === "Home") { event.preventDefault(); setSelection(null); setResetToken(token => token + 1); }
  }

  const select = (next: Selection) => {
    setHover(null);
    if (next?.type === "cluster" && selection?.type === "cluster" && selection.id === next.id) { setSelection(null); return; } // second click closes the area
    setSelection(next);
  };
  const background = () => setSelection(current => current?.type === "node" && data
    ? (() => { const node = data.nodes.find(item => item.id === current.id); return node && node.cluster !== "core" ? { type: "cluster" as const, id: node.cluster } : null; })() : null);
  const sceneProps: SceneProps | null = data ? { data, selection, expanded, mode, highlightIds: highlight, reducedMotion: reduced, active: open && use3d && !sceneError, resetToken,
    onSelect: select, onBackground: background, onHover: setHover } : null;
  const showScene = use3d && !sceneError;
  const announce = data ? selectedNode ? `${selectedNode.label}: ${data.labels.operation[data.runtime.nodes[selectedNode.id]?.status ?? "unknown"].label}`
    : selection?.type === "cluster" ? `Bereich ${data.labels.clusters[selection.id].label} geöffnet` : selection?.type === "jarvis" ? "Jarvis, Gesamtübersicht" : "Gesamtansicht" : "";

  return <>
  <div className="ccLauncher"><button type="button" className="ghost" onClick={() => { setOpen(true); if (!data) void load(); }}>Jarvis 3D Command Center öffnen</button><small>Nur Lesezugriff. Keine Schreibzugriffe, keine Anbieteraufrufe, keine Veröffentlichung.</small></div>
  <section className="ccRoot" hidden={!open} role="dialog" aria-modal="true" aria-label="Jarvis 3D Command Center" data-testid="command-center">
    <div className="ccHead"><div><h3>Jarvis Command Center</h3><p className="muted">{data?.meta.basis}</p></div><button type="button" className="ghost" onClick={() => setOpen(false)}>Schließen</button></div>
    {loading && <p role="status" className="muted">Architekturdaten werden geladen …</p>}
    {error && <p role="alert" className="error">{error} {password ? "" : "Bitte zuerst den Zugangscode eintragen."} <button type="button" className="ghost" onClick={() => void load()}>Erneut versuchen</button></p>}
    {data && <>
      {(!use3d || sceneError) && <p role="status" className="muted" data-testid="cc-fallback-note">{sceneError ? `3D-Szene nicht verfügbar (${sceneError}). ` : webglSupported ? "" : "WebGL wird von diesem Browser nicht unterstützt. "}2D-Ansicht aktiv – alle Informationen bleiben verfügbar.</p>}
      <div className="ccToolbar">
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Komponente suchen …" aria-label="Komponente suchen" />
        <div role="group" aria-label="Ansicht" className="ccSegment">
          <button type="button" className={mode === "architecture" ? "primary" : "ghost"} aria-pressed={mode === "architecture"} onClick={() => setMode("architecture")}>Architektur</button>
          <button type="button" className={mode === "process" ? "primary" : "ghost"} aria-pressed={mode === "process"} onClick={() => { setMode("process"); setSelection(null); }}>Ablauf</button>
        </div>
        <button type="button" className="ghost" onClick={() => { setSelection(null); setQuery(""); setResetToken(token => token + 1); }}>Gesamtansicht</button>
        {use3d && !sceneError && <button type="button" className="ghost" onClick={() => setUse3d(false)}>2D-Ansicht</button>}
        {!use3d && webglSupported && <button type="button" className="ghost" onClick={() => { setSceneError(""); setUse3d(true); setSceneMounted(true); }}>3D-Ansicht</button>}
        <button type="button" className="ghost" onClick={() => void load()} title="Status neu vom Server laden">Aktualisieren</button>
      </div>
      <nav className="ccChips" aria-label="Hauptbereiche">{clusters.map(id => <button key={id} type="button" aria-pressed={expanded === id} className={`ccChip ${expanded === id ? "ccChipOn" : ""}`}
        style={{ borderColor: data.labels.clusters[id].color }} onClick={() => select({ type: "cluster", id })}>{data.labels.clusters[id].label}</button>)}</nav>
      {mode === "process" && <ProcessRibbon data={data} onSelect={select} />}
      <div className="ccBody">
        <div className="ccStage" data-testid="cc-stage" tabIndex={showScene ? 0 : -1} onKeyDown={showScene ? onStageKey : undefined}
          aria-label={showScene ? "3D-Ansicht. Pfeiltasten wechseln Bereiche und Komponenten, Enter öffnet, Pfeil hoch oder Escape geht zurück, Pos1 zeigt alles." : undefined}>
          {sceneMounted && !sceneError && sceneProps && <div style={{ height: "100%", display: showScene ? "block" : "none" }}><SceneBoundary onFail={setSceneError}><Scene {...sceneProps} /></SceneBoundary></div>}
          {!showScene && <GroupedView data={data} selection={selection} query={query} onSelect={select} />}
          {showScene && hover && <div className="ccTooltip" role="tooltip" style={{ left: hover.x, top: hover.y }}>
            <b>{hover.title}</b><span>{hover.text}</span></div>}
          {showScene && <p className="ccHint">Ziehen = drehen · Mausrad/Pinch = zoomen · Bereich anklicken = aufklappen · Leerraum = zurück · Tastatur: ← → Enter ↑ Pos1</p>}
        </div>
        <aside className="ccDetail" data-testid="cc-detail">
          <p className="ccSr" aria-live="polite">{announce}</p>
          {selectedNode ? <NodePanel data={data} node={selectedNode} onSelect={select} />
            : selection?.type === "cluster" ? <ClusterPanel data={data} cluster={selection.id} onSelect={select} />
              : <OverviewPanel data={data} onSelect={select} />}
        </aside>
      </div>
    </>}
  </section>
  </>;
}
