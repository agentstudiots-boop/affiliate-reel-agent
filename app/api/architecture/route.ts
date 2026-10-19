import { ARCHITECTURE_META, CLUSTER_META, DEPLOYMENT_META, EDGES, EDGE_META, IMPLEMENTATION_META, KIND_LABEL, NODES, OPERATION_META, PROCESS_STEPS, implementationOf } from "@/lib/architecture/model";
import { computeRuntime } from "@/lib/architecture/runtime";
import { readSnapshot } from "@/lib/architecture/snapshot";
import { readEnterpriseView } from "@/lib/architecture/enterprise-snapshot";
import { checkCapabilities } from "@/lib/capabilities";
import { authorized, unauthorizedResponse } from "@/lib/memory/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Command Center data. Operator-protected, GET only, never cached. Read-only: the static architecture model, the
// operational status computed on the server (variable NAMES and switches only, never values) and read-only database
// evidence (SELECT only; in preview the runtime guard blocks the database and the response says so). `enterprise` is the
// enterprise level (H-01): departments of the executive register with their own evidence or null, never invented values.
export async function GET(request: Request) {
  if (!authorized(request)) return unauthorizedResponse();
  const capabilities = checkCapabilities();
  const state = computeRuntime({ capabilities, snapshot: await readSnapshot() });
  const nodes = NODES.map(({ operation: _rule, ...node }) => ({ ...node, implementation: implementationOf({ ...node, operation: _rule }), deployment: node.since === "none" ? "not_deployed" : state.environment === "production" ? "production" : "preview" }));
  const enterprise = await readEnterpriseView();
  const missing = capabilities.filter(item => item.missing.length).map(item => ({ id: item.id, label: item.label, state: item.state, missing: item.missing }));
  return Response.json({ meta: ARCHITECTURE_META, nodes, edges: EDGES, process: PROCESS_STEPS, runtime: state, enterprise, missing,
    labels: { implementation: IMPLEMENTATION_META, deployment: DEPLOYMENT_META, operation: OPERATION_META, clusters: CLUSTER_META, edges: EDGE_META, kinds: KIND_LABEL } },
  { headers: { "Cache-Control": "no-store" } });
}
