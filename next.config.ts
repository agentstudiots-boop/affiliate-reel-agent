import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // WASM Opus decoder for WhatsApp voice notes: loaded from node_modules at runtime (its worker support cannot be bundled).
  serverExternalPackages: ["ogg-opus-decoder"],
  outputFileTracingIncludes: {
    "/api/admin/migrate": ["./db/migrations/*.sql"],
  },
};

export default nextConfig;
