"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CanvasTexture, Vector3, type Mesh } from "three";
import { CAMERA_FOV, CLUSTERS, HUB_RADIUS, clusterGoal, hubPosition, labelSizing, layoutNodes, nodeGoal, overviewGoal, type CameraGoal, type Vec3 } from "@/lib/architecture/layout";
import type { ClusterId, ComponentKind, OperationalStatus } from "@/lib/architecture/model";
import { processSegments } from "@/lib/architecture/process";
import type { ClientNode, Hover, Payload, Selection } from "@/app/architecture/types";

export type SceneProps = {
  data: Payload;
  selection: Selection;
  expanded: ClusterId | null;
  mode: "architecture" | "process";
  highlightIds: Set<string>;
  reducedMotion: boolean;
  /** false while the dialog is closed or the 2D view is shown: the render loop stops. */
  active: boolean;
  resetToken: number;
  onSelect: (selection: Selection) => void;
  onBackground: () => void;
  onHover: (hover: Hover) => void;
};

type ControlsHandle = { target: Vector3; update(): boolean | void; addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void };

// Two-line label as a sprite with a canvas texture: name + status in words (colour is never the only signal).
function Label({ title, sub, subColor, y, height, dim }: { title: string; sub?: string; subColor?: string; y: number; height: number; dim?: boolean }) {
  const { texture, aspect } = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const titleFont = "700 44px system-ui, sans-serif", subFont = "600 32px system-ui, sans-serif";
    let width = 200;
    if (ctx) { ctx.font = titleFont; width = ctx.measureText(title).width; if (sub) { ctx.font = subFont; width = Math.max(width, ctx.measureText(sub).width); } }
    const w = Math.ceil(width) + 36, h = sub ? 104 : 64;
    canvas.width = w; canvas.height = h;
    if (ctx) {
      ctx.fillStyle = "rgba(5,7,11,0.82)"; ctx.beginPath(); ctx.roundRect(0, 0, w, h, 16); ctx.fill();
      ctx.textBaseline = "middle"; ctx.font = titleFont; ctx.fillStyle = "#f2f6fb"; ctx.fillText(title, 18, sub ? 34 : 33);
      if (sub) { ctx.font = subFont; ctx.fillStyle = subColor ?? "#a9b4c4"; ctx.fillText(sub, 18, 78); }
    }
    return { texture: new CanvasTexture(canvas), aspect: w / h };
  }, [title, sub, subColor]);
  useEffect(() => () => texture.dispose(), [texture]);
  const scaled = height * (sub ? 1.55 : 1);
  return <sprite position={[0, y, 0]} scale={[scaled * aspect, scaled, 1]} renderOrder={10}>
    <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} opacity={dim ? 0.22 : 1} />
  </sprite>;
}

function Shape({ kind }: { kind: ComponentKind }) {
  switch (kind) {
    case "orchestrator": return <sphereGeometry args={[0.75, 32, 32]} />;
    case "agent": return <octahedronGeometry args={[0.7]} />;
    case "module": return <boxGeometry args={[0.95, 0.95, 0.95]} />;
    case "provider": return <cylinderGeometry args={[0.55, 0.55, 0.9, 24]} />;
    case "platform": return <torusGeometry args={[0.52, 0.22, 14, 32]} />;
    case "guard": return <icosahedronGeometry args={[0.68, 0]} />;
    case "external": return <tetrahedronGeometry args={[0.78]} />;
    default: return <dodecahedronGeometry args={[0.65]} />;
  }
}

// Tooltip coordinates relative to the canvas (offsetX/Y), so the DOM side needs no layout measurement.
function hoverHandlers(id: string, title: string, text: string, onHover: SceneProps["onHover"]) {
  return {
    onPointerOver: (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); document.body.style.cursor = "pointer"; onHover({ id, title, text, x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY }); },
    onPointerMove: (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); onHover({ id, title, text, x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY }); },
    onPointerOut: () => { document.body.style.cursor = ""; onHover(null); },
  };
}

function JarvisCore({ data, selected, reducedMotion, scale, onSelect, onHover }: { data: Payload; selected: boolean; reducedMotion: boolean; scale: number; onSelect: SceneProps["onSelect"]; onHover: SceneProps["onHover"] }) {
  const ring = useRef<Mesh>(null);
  const jarvis = data.nodes.find(node => node.cluster === "core");
  const status = jarvis ? data.runtime.nodes[jarvis.id]?.status ?? "unknown" : "unknown";
  useFrame((_, delta) => { if (ring.current && !reducedMotion) ring.current.rotation.z += delta * 0.25; });
  return <group>
    <mesh onClick={event => { event.stopPropagation(); onSelect({ type: "jarvis" }); }} {...hoverHandlers("jarvis", "JARVIS", jarvis?.plain ?? "", onHover)}>
      <sphereGeometry args={[2.2, 48, 48]} />
      <meshStandardMaterial color="#7cf5ff" emissive="#2fb8d6" emissiveIntensity={selected ? 1.1 : 0.7} roughness={0.35} metalness={0.25} />
    </mesh>
    <mesh ref={ring} rotation={[Math.PI / 2.4, 0, 0]}><torusGeometry args={[3.1, 0.06, 12, 96]} /><meshBasicMaterial color="#7cf5ff" transparent opacity={0.55} /></mesh>
    <Label title="JARVIS" sub={`Zentrale · ${data.labels.operation[status].label}`} subColor={data.labels.operation[status].color} y={3.6 + (scale - 1) * 1.5} height={1.25 * scale} />
  </group>;
}

function Hub({ data, cluster, expanded, dim, scale, compact, onSelect, onHover }: { data: Payload; cluster: ClusterId; expanded: boolean; dim: boolean; scale: number; compact: boolean; onSelect: SceneProps["onSelect"]; onHover: SceneProps["onHover"] }) {
  const meta = data.labels.clusters[cluster];
  const members = data.nodes.filter(node => node.cluster === cluster);
  const problems = members.filter(node => ["error", "not_configured"].includes(data.runtime.nodes[node.id]?.status ?? "")).length;
  const sub = `${members.length} Komponenten${problems ? ` · ${problems} mit Handlungsbedarf` : ""}`;
  return <group position={hubPosition(cluster)}>
    <mesh scale={expanded ? 1.2 : 1} onClick={event => { event.stopPropagation(); onSelect({ type: "cluster", id: cluster }); }}
      {...hoverHandlers(`cluster:${cluster}`, meta.label, `${meta.plain} Klicken zum Aufklappen.`, onHover)}>
      <sphereGeometry args={[1.35, 36, 36]} />
      <meshStandardMaterial color={meta.color} emissive={meta.color} emissiveIntensity={expanded ? 0.75 : 0.4} transparent opacity={dim ? 0.3 : 0.95} roughness={0.4} />
    </mesh>
    <mesh rotation={[Math.PI / 2, 0, 0]} scale={expanded ? 1.25 : 1}><ringGeometry args={[1.75, 1.85, 64]} /><meshBasicMaterial color={meta.color} transparent opacity={dim ? 0.12 : 0.5} side={2} /></mesh>
    {/* Opened: the components carry the information, the area label steps back (smaller, above, no second line). */}
    {expanded ? <Label title={meta.label} y={3.2} height={0.7 * scale} />
      : compact ? <Label title={`${meta.short ?? meta.label}${problems ? ` · ${problems} offen` : ""}`} y={2.4 + (scale - 1) * 0.9} height={1.0 * scale} dim={dim} />
      : <Label title={meta.label} sub={sub} subColor={problems ? "#ffb020" : "#a9b4c4"} y={2.5 + (scale - 1) * 1.4} height={1.0 * scale} dim={dim} />}
  </group>;
}

function ComponentNode({ data, node, position, selected, dim, step, scale, reducedMotion, onSelect, onHover }: { data: Payload; node: ClientNode; position: Vec3; selected: boolean; dim: boolean; step: number | null; scale: number;
  reducedMotion: boolean; onSelect: SceneProps["onSelect"]; onHover: SceneProps["onHover"] }) {
  const ref = useRef<Mesh>(null);
  const status: OperationalStatus = data.runtime.nodes[node.id]?.status ?? "unknown";
  const color = data.labels.operation[status].color;
  useFrame((_, delta) => { if (ref.current && !reducedMotion && selected) ref.current.rotation.y += delta * 0.6; });
  return <group position={position}>
    <mesh ref={ref} scale={selected ? 1.3 : 1} onClick={event => { event.stopPropagation(); onSelect({ type: "node", id: node.id }); }}
      {...hoverHandlers(node.id, node.label, `${node.plain} Status: ${data.labels.operation[status].label}.`, onHover)}>
      <Shape kind={node.kind} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.9 : 0.35} roughness={0.45} transparent opacity={dim ? 0.18 : 0.95} wireframe={node.implementation === "planned"} />
    </mesh>
    {selected && <mesh rotation={[Math.PI / 2, 0, 0]}><ringGeometry args={[1.05, 1.15, 48]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.8} side={2} /></mesh>}
    <Label title={`${step ? `${step} · ` : ""}${node.short}`} sub={data.labels.operation[status].label} subColor={color} y={1.35 + (scale - 1) * 0.6} height={0.62 * scale} dim={dim} />
  </group>;
}

function Pulse({ from, to, color, offset }: { from: Vec3; to: Vec3; color: string; offset: number }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.elapsedTime * 0.25 + offset) % 1;
    ref.current.position.set(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t);
  });
  return <mesh ref={ref}><sphereGeometry args={[0.13, 10, 10]} /><meshBasicMaterial color={color} /></mesh>;
}

const tmpPos = new Vector3(), tmpTarget = new Vector3();
function CameraRig({ goal, goalKey, reducedMotion }: { goal: CameraGoal; goalKey: string; reducedMotion: boolean }) {
  const controls = useThree(state => state.controls) as unknown as ControlsHandle | null;
  const camera = useThree(state => state.camera);
  const invalidate = useThree(state => state.invalidate);
  const animating = useRef(true);
  useEffect(() => {
    animating.current = true;
    if (reducedMotion && controls) {
      camera.position.set(...goal.position); controls.target.set(...goal.target); controls.update();
      animating.current = false;
    }
    invalidate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalKey, controls]);
  useEffect(() => {
    if (!controls) return;
    const stop = () => { animating.current = false; };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);
  useFrame((_, delta) => {
    if (!animating.current || !controls) return;
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 3.2);
    tmpPos.set(...goal.position); tmpTarget.set(...goal.target);
    camera.position.lerp(tmpPos, k); controls.target.lerp(tmpTarget, k); controls.update();
    if (camera.position.distanceTo(tmpPos) < 0.03 && controls.target.distanceTo(tmpTarget) < 0.03) animating.current = false;
    else invalidate();
  });
  return null;
}

function Scene(props: SceneProps) {
  const { data, selection, expanded, mode, highlightIds, reducedMotion, resetToken, onSelect } = props;
  const size = useThree(state => state.size);
  const aspect = size.width / Math.max(1, size.height);
  const { scale: labels, compact } = labelSizing(aspect, size.height);
  // Keeps the tooltip inside the stage.
  const onHover: SceneProps["onHover"] = hover => props.onHover(hover ? { ...hover, x: Math.max(8, Math.min(hover.x + 14, size.width - 260)), y: Math.max(8, Math.min(hover.y + 14, size.height - 90)) } : null);
  const layout = useMemo(() => layoutNodes(data.nodes.map(node => ({ ...node, operation: { type: "code" as const } }))), [data.nodes]);
  const byId = useMemo(() => new Map(data.nodes.map(node => [node.id, node])), [data.nodes]);
  const processIds = useMemo(() => data.process.flatMap(step => step.nodes), [data.process]);
  const stepOf = useMemo(() => new Map(data.process.flatMap((step, index) => step.nodes.map(id => [id, index + 1] as const))), [data.process]);
  const selectedId = selection?.type === "node" ? selection.id : null;
  const searching = highlightIds.size > 0;

  // Which components are visible: process mode = the flow; otherwise the opened area (plus search hits).
  const visible = new Set<string>();
  if (mode === "process") processIds.forEach(id => { if (byId.get(id)?.cluster !== "core") visible.add(id); });
  else {
    if (expanded) data.nodes.filter(node => node.cluster === expanded).forEach(node => visible.add(node.id));
    highlightIds.forEach(id => { if (byId.get(id)?.cluster !== "core") visible.add(id); });
  }
  const pos = (id: string): Vec3 => {
    const node = byId.get(id);
    if (!node || node.cluster === "core") return [0, 0, 0];
    return visible.has(id) ? layout[id] : hubPosition(node.cluster);
  };

  // Connections: only those touching the opened area (or the selected component); hidden ends collapse onto their hub.
  const segments: { key: string; from: Vec3; to: Vec3; color: string; dashed: boolean; strong: boolean }[] = [];
  if (mode === "process") {
    processSegments(data.process).forEach(([a, b], index) => segments.push({ key: `p${index}`, from: pos(a), to: pos(b), color: "#7cf5ff", dashed: false, strong: true }));
  } else if (expanded || selectedId) {
    const seen = new Set<string>();
    for (const edge of data.edges) {
      const touches = selectedId ? edge.from === selectedId || edge.to === selectedId : visible.has(edge.from) || visible.has(edge.to);
      if (!touches) continue;
      const from = pos(edge.from), to = pos(edge.to);
      const key = [from.join(","), to.join(",")].sort().join("|");
      if (from.join() === to.join() || seen.has(key)) continue;
      seen.add(key);
      segments.push({ key: edge.id, from, to, color: data.labels.edges[edge.kind].color, dashed: !!edge.planned, strong: !!selectedId });
    }
  }

  let goal: CameraGoal;
  if (selectedId && byId.get(selectedId)) goal = nodeGoal(pos(selectedId), byId.get(selectedId)!.cluster, aspect);
  else if (selection?.type === "cluster") goal = clusterGoal(selection.id, data.nodes.filter(node => node.cluster === selection.id).length, aspect);
  else goal = overviewGoal(aspect);
  const goalKey = `${goal.position.join(",")}|${goal.target.join(",")}|${resetToken}`;

  const ring = useMemo(() => Array.from({ length: 129 }, (_, i) => { const a = (i / 128) * Math.PI * 2; return [Math.cos(a) * HUB_RADIUS, 0, Math.sin(a) * HUB_RADIUS] as Vec3; }), []);
  const dimNode = (id: string) => (searching && !highlightIds.has(id)) || (!!selectedId && selectedId !== id && !data.edges.some(edge => (edge.from === selectedId && edge.to === id) || (edge.to === selectedId && edge.from === id)));

  return <>
    <color attach="background" args={["#05070b"]} />
    <fog attach="fog" args={["#05070b", 55, 120]} />
    <ambientLight intensity={0.6} />
    <pointLight position={[0, 10, 0]} intensity={120} color="#9ff7ff" />
    <pointLight position={[25, 12, 25]} intensity={60} color="#c7b0ff" />
    <Line points={ring} color="#2a3446" lineWidth={1} transparent opacity={0.7} />
    {CLUSTERS.map(cluster => {
      const dim = mode === "process" || (!!expanded && expanded !== cluster);
      return <Line key={`spoke-${cluster}`} points={[[0, 0, 0], hubPosition(cluster)]} color={data.labels.clusters[cluster].color} lineWidth={1.5} transparent opacity={dim ? 0.1 : 0.35} />;
    })}
    <group onPointerMissed={() => props.onBackground()}>
      <JarvisCore data={data} selected={selection?.type === "jarvis"} reducedMotion={reducedMotion} scale={labels} onSelect={onSelect} onHover={onHover} />
      {CLUSTERS.map(cluster => <Hub key={cluster} data={data} cluster={cluster} expanded={expanded === cluster} dim={mode === "process" || (!!expanded && expanded !== cluster)} scale={labels} compact={compact} onSelect={onSelect} onHover={onHover} />)}
      {segments.map(segment => <group key={segment.key}>
        <Line points={[segment.from, segment.to]} color={segment.color} lineWidth={segment.strong ? 2.2 : 1.4} transparent opacity={segment.strong ? 0.9 : 0.55} dashed={segment.dashed} dashSize={0.45} gapSize={0.3} />
        {mode === "process" && !reducedMotion && <Pulse from={segment.from} to={segment.to} color={segment.color} offset={(segment.key.length * 0.37) % 1} />}
      </group>)}
      {[...visible].map(id => { const node = byId.get(id)!; return <ComponentNode key={id} data={data} node={node} position={layout[id]} selected={selectedId === id} dim={dimNode(id)}
        step={mode === "process" ? stepOf.get(id) ?? null : null} scale={Math.min(1.6, labels)} reducedMotion={reducedMotion} onSelect={onSelect} onHover={onHover} />; })}
    </group>
    <CameraRig goal={goal} goalKey={goalKey} reducedMotion={reducedMotion} />
    <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={5} maxDistance={95} maxPolarAngle={Math.PI * 0.49} />
  </>;
}

export default function ArchitectureScene(props: SceneProps) {
  const initial = overviewGoal(1.6);
  return <Canvas camera={{ position: initial.position, fov: CAMERA_FOV }} dpr={[1, 1.75]} frameloop={!props.active ? "never" : props.reducedMotion ? "demand" : "always"}
    gl={{ antialias: true, powerPreference: "default" }} aria-label="Interaktive 3D-Darstellung der Jarvis-Architektur" data-testid="cc-canvas">
    <Scene {...props} />
  </Canvas>;
}
