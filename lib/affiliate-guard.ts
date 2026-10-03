import { amazonProduct, associateTag } from "./amazon";

// GENERATE ≠ VISIT. Affiliate links are data for Jarvis, never a target. They may be created, read from the
// database, stored, assigned to content and validated structurally, but no code path may request them:
// no GET/HEAD/redirect check/health check/browser automation/prefetch/preview. This module is the central guard.

export const AFFILIATE_ACCESS_BLOCKED = "affiliate_link_access_blocked";

export class AffiliateLinkBlockedError extends Error {
  readonly code = AFFILIATE_ACCESS_BLOCKED;
  constructor(readonly context: string) { super(`${AFFILIATE_ACCESS_BLOCKED}: ${context}`); this.name = "AffiliateLinkBlockedError"; }
}

const AMAZON_HOST = /(?:^|\.)(?:amazon\.[a-z.]{2,6}|amzn\.(?:to|eu|com|asia)|a\.co|amazon-adsystem\.com)$/i;
const TRACKING_PARAMS = new Set(["tag", "linkcode", "ascsubtag", "creativeasin", "linkid", "camp", "creative"]);

// Recognised by domain and tracking parameters: an Amazon-family host with any associate tracking parameter, or any
// host whose own `tag` parameter is our tracking ID. Request bodies are not inspected; they carry captions, not targets.
export function isAffiliateUrl(input: string | URL): boolean {
  let url: URL;
  try { url = new URL(String(input)); } catch { return false; }
  const keys = [...url.searchParams.keys()].map(key => key.toLowerCase());
  const ours = associateTag().toLowerCase();
  if (url.searchParams.getAll("tag").some(value => value.toLowerCase() === ours)) return true;
  if (AMAZON_HOST.test(url.hostname) && keys.some(key => TRACKING_PARAMS.has(key))) return true;
  // Tracking ID smuggled into a redirect parameter of an Amazon-family link.
  return AMAZON_HOST.test(url.hostname) && decodeURIComponent(url.search.replace(/\+/g, " ")).toLowerCase().includes(`tag=${ours}`);
}

function targetOf(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === "object" && "url" in input) return String((input as { url: unknown }).url);
  return "";
}

// Structured safety event: never contains the URL, the tag or a query string.
function safetyEvent(context: string, target: string) {
  let host = "invalid";
  try { host = new URL(target).hostname; } catch { /* keep */ }
  console.error(JSON.stringify({ event: AFFILIATE_ACCESS_BLOCKED, context, host }));
}

// Throws (and logs once) before any network activity if the target is an affiliate link.
export function assertNoAffiliateAccess(target: string | URL | Request, context = "fetch"): void {
  const text = targetOf(target);
  if (!isAffiliateUrl(text)) return;
  safetyEvent(context, text);
  throw new AffiliateLinkBlockedError(context);
}

// A fetch that refuses affiliate targets (all methods, headers, redirect modes). No retries are made by the guard.
export function guardedFetch(inner: typeof fetch = fetch): typeof fetch {
  const guarded = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    try { assertNoAffiliateAccess(input as string | URL | Request, "fetch"); }
    catch (error) { return Promise.reject(error); }
    return inner(input, init);
  }) as typeof fetch;
  return guarded;
}

const INSTALLED = Symbol.for("affiliate-link-safety-guard");
// Wraps the global fetch once per server instance so that every current and future module is covered.
export function installAffiliateFetchGuard(target: { fetch: typeof fetch } = globalThis as unknown as { fetch: typeof fetch }) {
  const current = target.fetch as typeof fetch & { [INSTALLED]?: boolean };
  if (current[INSTALLED]) return false;
  const wrapped = guardedFetch(current) as typeof fetch & { [INSTALLED]?: boolean };
  wrapped[INSTALLED] = true;
  target.fetch = wrapped;
  return true;
}

// Structural validation only; never performs a request. Product detail page + our tracking ID, nothing else.
export function affiliateLinkStructureIssue(raw: string, expectedAsin?: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return "invalid_url"; }
  const product = amazonProduct(raw);
  if (!product) return "not_a_product_detail_page";           // search, category, bestseller, generic Amazon pages
  if (expectedAsin && product.asin !== expectedAsin) return "asin_mismatch";
  if (url.hostname !== "www.amazon.de" || url.pathname !== `/dp/${product.asin}`) return "unexpected_structure";
  if ([...url.searchParams.keys()].join(",") !== "tag") return "unexpected_parameters";
  if (url.searchParams.get("tag") !== associateTag()) return "tracking_id_mismatch";
  return null;
}
