// Server start: install the central affiliate-link safety guard (GENERATE ≠ VISIT). See lib/affiliate-guard.ts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installAffiliateFetchGuard } = await import("./lib/affiliate-guard");
    installAffiliateFetchGuard();
    // Preview/development deployments may hold production credentials: refuse state-changing third-party calls there.
    const { installEgressGuard } = await import("./lib/security/runtime-guard");
    installEgressGuard();
  }
}
