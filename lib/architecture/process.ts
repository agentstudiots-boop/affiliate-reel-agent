import type { PROCESS_STEPS } from "./model";

// Segments of the process path, in order (pure, testable): within a step either a chain or a fan-in to its last
// component; between steps from the last component of one step to the first of the next.
export function processSegments(steps: Pick<(typeof PROCESS_STEPS)[number], "nodes" | "flow">[]): [string, string][] {
  const segments: [string, string][] = [];
  steps.forEach((step, index) => {
    const ids = step.nodes;
    if (step.flow === "fan_in") ids.slice(0, -1).forEach(id => segments.push([id, ids[ids.length - 1]]));
    else for (let i = 0; i + 1 < ids.length; i++) segments.push([ids[i], ids[i + 1]]);
    const next = steps[index + 1];
    if (next && ids.length && next.nodes.length) segments.push([ids[ids.length - 1], next.nodes[0]]);
  });
  return segments.filter(([a, b]) => a !== b);
}
