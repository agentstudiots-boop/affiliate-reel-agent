import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/admin/migrate": ["./db/migrations/*.sql"],
  },
};

export default nextConfig;
