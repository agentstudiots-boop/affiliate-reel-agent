import type { ArchEdge, ArchNode, ClusterId, ComponentKind, DeploymentStatus, EdgeKind, ImplementationStatus, OperationalStatus } from "@/lib/architecture/model";
import type { RuntimeState } from "@/lib/architecture/runtime";

// Shape of GET /api/architecture as the browser receives it (types only; no server code is bundled).
export type ClientNode = Omit<ArchNode, "operation"> & { implementation: ImplementationStatus; deployment: DeploymentStatus };
export type ProcessStep = { id: string; label: string; plain: string; nodes: string[]; flow?: "fan_in" };
export type Payload = {
  meta: { basis: string };
  nodes: ClientNode[];
  edges: ArchEdge[];
  process: ProcessStep[];
  runtime: RuntimeState;
  missing: { id: string; label: string; state: string; missing: string[] }[];
  labels: {
    implementation: Record<ImplementationStatus, { label: string; description: string }>;
    deployment: Record<DeploymentStatus, { label: string; description: string }>;
    operation: Record<OperationalStatus, { label: string; color: string; description: string }>;
    clusters: Record<ClusterId, { label: string; short: string; color: string; plain: string; order: number }>;
    edges: Record<EdgeKind, { label: string; color: string }>;
    kinds: Record<ComponentKind, string>;
  };
};
export type Selection = { type: "jarvis" } | { type: "cluster"; id: ClusterId } | { type: "node"; id: string } | null;
export type Hover = { id: string; title: string; text: string; x: number; y: number } | null;
