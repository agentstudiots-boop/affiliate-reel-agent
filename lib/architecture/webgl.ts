// WebGL capability probe for the Command Center (browser only, called from an event handler, never during render).
//
// Probed at most once per page: every probe creates a WebGL context and browsers cap the number of live contexts (when
// exceeded they drop the oldest, which can be the 3D scene itself). The probe context is released immediately.

type CanvasFactory = { createElement(tag: "canvas"): { getContext(kind: string): unknown } };
type ProbeContext = { getExtension(name: string): { loseContext(): void } | null } | null;

let cached: boolean | null = null;

export function webglAvailable(doc: CanvasFactory = document as unknown as CanvasFactory): boolean {
  if (cached !== null) return cached;
  try {
    const canvas = doc.createElement("canvas");
    const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as ProbeContext;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    cached = !!gl;
  } catch { cached = false; }
  return cached;
}

/** Tests only. */
export function resetWebglProbe() { cached = null; }
