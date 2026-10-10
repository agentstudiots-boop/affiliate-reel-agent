import { ARCHITECTURE_META, CLUSTER_META, EDGES, EDGE_META, KIND_LABEL, NODES, STATUS_META } from "@/lib/architecture/model";
import { checkCapabilities } from "@/lib/capabilities";
import { authorized, unauthorizedResponse } from "@/lib/memory/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only architecture inventory for the 3D Command Center. No database access, no provider calls, no writes.
// `deployment` lists only variable NAMES that are missing in this deployment (never values).
export async function GET(request: Request) {
  if (!authorized(request)) return unauthorizedResponse();
  const deployment = checkCapabilities().map(item => ({ id: item.id, label: item.label, state: item.state, missing: item.missing }));
  return Response.json({ meta: ARCHITECTURE_META, nodes: NODES, edges: EDGES, statusMeta: STATUS_META, clusterMeta: CLUSTER_META, edgeMeta: EDGE_META, kindLabel: KIND_LABEL, deployment },
    { headers: { "Cache-Control": "no-store" } });
}
