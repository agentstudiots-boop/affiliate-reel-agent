import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // WASM Opus decoder for WhatsApp voice notes: loaded from node_modules at runtime (its worker support cannot be bundled).
  serverExternalPackages: ["ogg-opus-decoder"],
  outputFileTracingIncludes: {
    "/api/admin/migrate": ["./db/migrations/*.sql"],
    // Command Center development status (D-06): only the hand-over files, read-only.
    "/api/architecture": ["./docs/ai-business/coordination/tasks/*/task.json"],
  },
};

export default nextConfig;
