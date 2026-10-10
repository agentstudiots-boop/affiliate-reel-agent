import { CLUSTER_META, NODES, type ArchNode, type ClusterId } from "./model";

// Deterministic 3D layout: Jarvis in the centre, the other clusters on a ring (alternating heights), the members of a
// cluster on a small ring around their cluster anchor. Pure function so it is testable without WebGL.
export type Vec3 = [number, number, number];

const CLUSTERS = Object.keys(CLUSTER_META) as ClusterId[];
const RING = 14;

export function clusterAnchor(cluster: ClusterId): Vec3 {
  if (cluster === "core") return [0, 0, 0];
  const others = CLUSTERS.filter(id => id !== "core");
  const index = others.indexOf(cluster);
  const angle = (index / others.length) * Math.PI * 2;
  return [Math.cos(angle) * RING, index % 2 === 0 ? 2.2 : -2.2, Math.sin(angle) * RING];
}

export function layoutNodes(nodes: ArchNode[] = NODES): Record<string, Vec3> {
  const positions: Record<string, Vec3> = {};
  for (const cluster of CLUSTERS) {
    const members = nodes.filter(node => node.cluster === cluster);
    const [ax, ay, az] = clusterAnchor(cluster);
    members.forEach((node, index) => {
      if (node.id === "jarvis") { positions[node.id] = [0, 0, 0]; return; }
      if (cluster === "core") { const a = (index / Math.max(1, members.length - 1)) * Math.PI * 2; positions[node.id] = [Math.cos(a + 1.2) * 5.5, 2.2, Math.sin(a + 1.2) * 5.5]; return; }
      const radius = 1.6 + Math.min(2.6, members.length * 0.32);
      const a = (index / members.length) * Math.PI * 2 + 0.4;
      positions[node.id] = [ax + Math.cos(a) * radius, ay + ((index % 3) - 1) * 0.9, az + Math.sin(a) * radius];
    });
  }
  return positions;
}
