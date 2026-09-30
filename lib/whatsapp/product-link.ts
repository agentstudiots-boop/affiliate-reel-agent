import { amazonProduct } from "../amazon";

// Only these exact hosts and paths can be used as product identity input.
// A link preview, search page or arbitrary redirect is never a product proof.
export function operatorProductLink(body: string): string | null {
  const links = body.match(/https:\/\/[^\s<>]+/gi) || [];
  if (links.length !== 1) return null;
  const raw = links[0].replace(/[.,;!?)]+$/, "");
  if (amazonProduct(raw)) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "amzn.eu" && !url.port
      && !url.username && !url.password && !url.search && !url.hash
      && /^\/d\/[A-Za-z0-9]{6,20}$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

export async function asinFromOperatorLink(link: string, request: typeof fetch = fetch): Promise<string> {
  const direct = amazonProduct(link);
  if (direct) return direct.asin;
  if (operatorProductLink(link) !== link) throw Error("product_link_unresolved");
  const response = await request(link, {
    method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(12000),
  });
  if (![301,302,303,307,308].includes(response.status)) throw Error("product_link_unresolved");
  const target = response.headers.get("location");
  if (!target) throw Error("product_link_unresolved");
  const url = new URL(target,link);
  const product = amazonProduct(url.href);
  if (!product) throw Error("product_link_unresolved");
  return product.asin;
}
