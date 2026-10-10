import { CLUSTER_META, NODES, type ArchNode, type ClusterId } from "./model";

// Deterministic orbital layout, pure functions (testable without WebGL):
//   Jarvis at the origin · the seven main areas evenly on a ring (process order, clockwise from the front)
//   · the components of an area on a small ring around its hub, only shown when the area is opened.
export type Vec3 = [number, number, number];

export const HUB_RADIUS = 15;
export const CLUSTERS = (Object.keys(CLUSTER_META) as ClusterId[]).sort((a, b) => CLUSTER_META[a].order - CLUSTER_META[b].order);

export function hubPosition(cluster: ClusterId): Vec3 {
  const index = CLUSTERS.indexOf(cluster);
  const angle = Math.PI / 2 + (index / CLUSTERS.length) * Math.PI * 2; // index 0 in front of Jarvis (towards the camera)
  return [round(Math.cos(angle) * HUB_RADIUS), 0, round(Math.sin(angle) * HUB_RADIUS)];
}

// Ring radius grows with the number of members so neighbouring labels keep their distance.
export const childRadius = (count: number) => Math.max(4.2, 0.95 * count);

export function childPositions(cluster: ClusterId, ids: string[]): Record<string, Vec3> {
  const [hx, , hz] = hubPosition(cluster);
  const radius = childRadius(ids.length);
  const outward = Math.atan2(hz, hx);
  const out: Record<string, Vec3> = {};
  ids.forEach((id, index) => {
    const angle = outward + (index / ids.length) * Math.PI * 2;
    // Alternating height: labels of neighbours never sit on the same line.
    out[id] = [round(hx + Math.cos(angle) * radius), index % 2 === 0 ? 1.2 : -0.6, round(hz + Math.sin(angle) * radius)];
  });
  return out;
}

export function layoutNodes(nodes: ArchNode[] = NODES): Record<string, Vec3> {
  const positions: Record<string, Vec3> = {};
  for (const node of nodes) if (node.cluster === "core") positions[node.id] = [0, 0, 0];
  for (const cluster of CLUSTERS) Object.assign(positions, childPositions(cluster, nodes.filter(node => node.cluster === cluster).map(node => node.id)));
  return positions;
}

export type CameraGoal = { position: Vec3; target: Vec3 };

export const CAMERA_FOV = 45;
// Half the width the overview must show: hub ring plus the width of a hub label.
const OVERVIEW_HALF_WIDTH = HUB_RADIUS + 8;

// Whole system in view: the distance follows from the horizontal field of view, so the ring fits on wide and narrow screens.
export function overviewGoal(aspect: number): CameraGoal {
  const halfHorizontal = Math.tan((CAMERA_FOV * Math.PI) / 360) * Math.max(0.35, aspect);
  const distance = Math.max(34, Math.min(95, OVERVIEW_HALF_WIDTH / halfHorizontal));
  // The front of the ring is nearer to the camera and appears larger and lower; aiming slightly forward centres the ring.
  return { position: [0, round(distance * 0.62), round(distance * 0.78 + 3)], target: [0, 0, 3] };
}
// Label size from the overview distance and the stage's pixel height: the hub title should be about 14 px tall
// (title ≈ 0.79 · height · pixels / distance). Small stages use short one-line area names so labels never overlap.
export function labelSizing(aspect: number, heightPx: number) {
  const distance = Math.hypot(...overviewGoal(aspect).position);
  const scale = Math.min(2.4, Math.max(1, (14 * distance) / (0.79 * Math.max(200, heightPx))));
  return { scale, compact: aspect < 1 || heightPx < 460 };
}
// An opened area: looked at from outside, Jarvis behind it.
export function clusterGoal(cluster: ClusterId, count: number, aspect: number): CameraGoal {
  const hub = hubPosition(cluster);
  const length = Math.hypot(hub[0], hub[2]) || 1;
  const away = (childRadius(count) * 2.2 + 6) * (aspect < 1 ? 1.35 : 1);
  return { position: [round(hub[0] + (hub[0] / length) * away), round(away * 0.75), round(hub[2] + (hub[2] / length) * away)], target: hub };
}
export function nodeGoal(position: Vec3, cluster: ClusterId | "core", aspect: number): CameraGoal {
  if (cluster === "core") return overviewGoal(aspect);
  const hub = hubPosition(cluster);
  const length = Math.hypot(hub[0], hub[2]) || 1;
  const away = aspect < 1 ? 11 : 8.5;
  return { position: [round(position[0] + (hub[0] / length) * away), round(position[1] + away * 0.65), round(position[2] + (hub[2] / length) * away)], target: position };
}

function round(value: number) { return Math.round(value * 1000) / 1000; }
