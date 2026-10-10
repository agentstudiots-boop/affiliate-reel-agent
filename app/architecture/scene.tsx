"use client";

import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";

// Text labels are sprites with a canvas texture (no DOM overlay, no nested React roots, no font download).
function LabelSprite({ text, highlighted, dimmed, y }: { text: string; highlighted: boolean; dimmed: boolean; y: number }) {
  const { texture, aspect } = useMemo(() => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const font = "600 34px system-ui, sans-serif";
    let width = 256;
    if (ctx) { ctx.font = font; width = Math.ceil(ctx.measureText(text).width) + 28; }
    canvas.width = width; canvas.height = 56;
    if (ctx) {
      ctx.fillStyle = "rgba(5,7,11,0.72)"; ctx.fillRect(0, 0, width, 56);
      ctx.font = font; ctx.fillStyle = "#e6edf7"; ctx.textBaseline = "middle"; ctx.fillText(text, 14, 29);
    }
    return { texture: new CanvasTexture(canvas), aspect: width / 56 };
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  const height = 0.5;
  return <sprite position={[0, y, 0]} scale={[height * aspect, height, 1]} renderOrder={10}><spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} opacity={dimmed ? 0.18 : highlighted ? 1 : 0.85} /></sprite>;
}
import { CanvasTexture, type Group, type Mesh, type Vector3 } from "three";
import { layoutNodes, type Vec3 } from "@/lib/architecture/layout";
import { CLUSTER_META, EDGE_META, STATUS_META, type ArchEdge, type ArchNode, type ComponentKind, type EdgeKind } from "@/lib/architecture/model";

type ControlsHandle = { target: Vector3; update(): boolean | void };

export type SceneProps = {
  nodes: ArchNode[];
  edges: ArchEdge[];
  selectedId: string | null;
  hiddenClusters: Set<string>;
  hiddenEdgeKinds: Set<EdgeKind>;
  highlightIds: Set<string>;
  mode: "architecture" | "process";
  reducedMotion: boolean;
  /** false while the dialog is closed or the 2D view is shown: the render loop stops. */
  active: boolean;
  resetToken: number;
  onSelect: (id: string | null) => void;
};

// Shape per component kind, so independent agents, internal modules, providers and platforms can be told apart without colour.
function Shape({ kind }: { kind: ComponentKind }) {
  switch (kind) {
    case "orchestrator": return <sphereGeometry args={[1, 40, 40]} />;
    case "agent": return <octahedronGeometry args={[0.62]} />;
    case "module": return <boxGeometry args={[0.8, 0.8, 0.8]} />;
    case "provider": return <cylinderGeometry args={[0.5, 0.5, 0.8, 24]} />;
    case "platform": return <torusGeometry args={[0.46, 0.2, 14, 32]} />;
    case "guard": return <icosahedronGeometry args={[0.6, 0]} />;
    case "external": return <tetrahedronGeometry args={[0.68]} />;
    default: return <dodecahedronGeometry args={[0.6]} />;
  }
}

function NodeMesh({ node, position, selected, dimmed, reducedMotion, showLabel, onSelect }: { node: ArchNode; position: Vec3; selected: boolean; dimmed: boolean; reducedMotion: boolean; showLabel: boolean; onSelect: (id: string) => void }) {
  const ref = useRef<Mesh>(null);
  const color = STATUS_META[node.status].color;
  const core = node.kind === "orchestrator" && node.id === "jarvis";
  const scale = core ? 1.9 : node.kind === "orchestrator" ? 1.25 : 1;
  const inactive = node.status === "disabled" || node.status === "planned";
  useFrame((_, delta) => { if (ref.current && !reducedMotion) ref.current.rotation.y += delta * (core ? 0.25 : 0.12); });
  return <group position={position} scale={scale}>
    <mesh ref={ref} onClick={event => { event.stopPropagation(); onSelect(node.id); }} onPointerOver={() => { document.body.style.cursor = "pointer"; }} onPointerOut={() => { document.body.style.cursor = ""; }}>
      <Shape kind={node.kind} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 1.1 : core ? 0.7 : 0.35} roughness={0.4} metalness={0.2}
        transparent opacity={dimmed ? 0.16 : inactive ? 0.55 : 0.95} wireframe={node.status === "planned"} />
    </mesh>
    <mesh scale={selected ? 1.9 : 1.55}><ringGeometry args={[0.72, 0.78, 40]} /><meshBasicMaterial color={CLUSTER_META[node.cluster].color} transparent opacity={dimmed ? 0.05 : 0.5} side={2} /></mesh>
    {showLabel && <LabelSprite text={node.label} highlighted={selected} dimmed={dimmed} y={core ? 1.5 : 1.15} />}
  </group>;
}

function Flow({ from, to, color, reducedMotion }: { from: Vec3; to: Vec3; color: string; reducedMotion: boolean }) {
  const ref = useRef<Mesh>(null);
  const offset = useMemo(() => (from[0] * 7 + to[2] * 3) % 1, [from, to]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = reducedMotion ? 0.5 : (clock.elapsedTime * 0.18 + Math.abs(offset)) % 1;
    ref.current.position.set(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t);
  });
  return <mesh ref={ref}><sphereGeometry args={[0.07, 8, 8]} /><meshBasicMaterial color={color} /></mesh>;
}

function CameraRig({ target, resetToken }: { target: Vec3; resetToken: number }) {
  const goal = useRef<Vec3>([0, 0, 0]);
  const last = useRef(resetToken);
  const controls = useThree(state => state.controls) as unknown as ControlsHandle | null;
  useEffect(() => { goal.current = target; }, [target]);
  useFrame(({ camera, invalidate }) => {
    if (!controls) return;
    if (last.current !== resetToken) { last.current = resetToken; camera.position.set(0, 26, 30); }
    const [gx, gy, gz] = goal.current;
    const t = controls.target;
    const dx = gx - t.x, dy = gy - t.y, dz = gz - t.z;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 0.01) { t.set(t.x + dx * 0.12, t.y + dy * 0.12, t.z + dz * 0.12); controls.update(); invalidate(); }
  });
  return null;
}

function Scene(props: SceneProps) {
  const { nodes, edges, selectedId, hiddenClusters, hiddenEdgeKinds, highlightIds, mode, reducedMotion, resetToken, onSelect } = props;
  const positions = useMemo(() => layoutNodes(nodes), [nodes]);
  const group = useRef<Group>(null);
  const visible = (node: ArchNode) => !hiddenClusters.has(node.cluster);
  const visibleIds = new Set(nodes.filter(visible).map(node => node.id));
  const focusNeighbours = new Set<string>();
  if (selectedId) { focusNeighbours.add(selectedId); for (const edge of edges) { if (edge.from === selectedId) focusNeighbours.add(edge.to); if (edge.to === selectedId) focusNeighbours.add(edge.from); } }
  const searching = highlightIds.size > 0;
  const dimmedNode = (id: string) => (selectedId ? !focusNeighbours.has(id) : false) || (searching && !highlightIds.has(id));
  const selectedPosition: Vec3 = selectedId && positions[selectedId] ? positions[selectedId] : [0, 0, 0];

  return <>
    <color attach="background" args={["#05070b"]} />
    <fog attach="fog" args={["#05070b", 40, 100]} />
    <ambientLight intensity={0.55} />
    <pointLight position={[0, 6, 0]} intensity={90} color="#7cf5ff" />
    <pointLight position={[18, -8, 10]} intensity={40} color="#b48cff" />
    <group ref={group} onPointerMissed={() => onSelect(null)}>
      {edges.filter(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to) && !hiddenEdgeKinds.has(edge.kind)).map(edge => {
        const touches = selectedId ? edge.from === selectedId || edge.to === selectedId : true;
        const color = EDGE_META[edge.kind].color;
        return <group key={edge.id}>
          <Line points={[positions[edge.from], positions[edge.to]]} color={color} lineWidth={mode === "process" ? 1.8 : 1} transparent opacity={touches ? (mode === "process" ? 0.85 : 0.5) : 0.07}
            dashed={edge.id.startsWith("i-cron-topic") || edge.to === "executive-agent"} dashSize={0.4} gapSize={0.3} />
          {mode === "process" && touches && <Flow from={positions[edge.from]} to={positions[edge.to]} color={color} reducedMotion={reducedMotion} />}
        </group>;
      })}
      {nodes.filter(visible).map(node => <NodeMesh key={node.id} node={node} position={positions[node.id]} selected={node.id === selectedId} dimmed={dimmedNode(node.id)}
        reducedMotion={reducedMotion} showLabel={node.id === selectedId || focusNeighbours.has(node.id) || node.kind === "orchestrator" || node.kind === "platform" || !selectedId} onSelect={onSelect} />)}
    </group>
    <CameraRig target={selectedPosition} resetToken={resetToken} />
    <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={6} maxDistance={70} autoRotate={false} />
  </>;
}

export default function ArchitectureScene(props: SceneProps) {
  return <Canvas camera={{ position: [0, 26, 30], fov: 50 }} dpr={[1, 1.75]} frameloop={!props.active ? "never" : props.reducedMotion ? "demand" : "always"} gl={{ antialias: true, powerPreference: "default" }}
    aria-label="Interaktive 3D-Darstellung der Jarvis-Architektur" data-testid="cc-canvas">
    <Scene {...props} />
  </Canvas>;
}
