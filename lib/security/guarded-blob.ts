import { head, put as rawPut } from "@vercel/blob";
import { assertEffectAllowed } from "./runtime-guard";

// @vercel/blob sends its requests through undici's own fetch, NOT globalThis.fetch (verified in node_modules/@vercel/blob
// dist: `import { fetch } from "undici"`). The global egress filter therefore cannot see Blob writes, so every Blob write
// of the application goes through this guarded `put`. Reads (`head`) are unchanged.
export const put: typeof rawPut = ((...args: Parameters<typeof rawPut>) => {
  assertEffectAllowed("storage_write");
  return rawPut(...args);
}) as typeof rawPut;
export { head };
