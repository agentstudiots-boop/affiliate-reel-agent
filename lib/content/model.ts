import type { Generator } from "./agent";

export function createGenerator(options: { mode: "reference" | "ai"; signal?: AbortSignal }): Generator {
  return async (_agent, _instruction, _input, schema, reference) => {
    options.signal?.throwIfAborted();
    if (options.mode === "reference") return schema.parse(reference());
    throw new Error("Kein generativer Inhaltsanbieter aktiv. Tavily bleibt auf Recherche begrenzt; Referenzmodus verwenden.");
  };
}
