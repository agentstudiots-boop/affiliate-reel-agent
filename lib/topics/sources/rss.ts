// Minimal, dependency-free RSS 2.0 item reader for well-known public feeds (Google News, Google Trends).
// Deliberately tolerant: unknown elements are ignored, a malformed item is skipped, never thrown.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

export function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeTag = (tag: string) => tag.replace(/[:.]/g, match => `\\${match}`);

export function tagText(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${escapeTag(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(tag)}>`, "i"));
  return match ? decodeXml(match[1]) : null;
}

export function tagAttribute(block: string, tag: string, attribute: string): string | null {
  const match = block.match(new RegExp(`<${escapeTag(tag)}\\s[^>]*\\b${attribute}="([^"]*)"`, "i"));
  return match ? decodeXml(match[1]) : null;
}

export function rssBlocks(xml: string, tag = "item"): string[] {
  return [...xml.matchAll(new RegExp(`<${escapeTag(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeTag(tag)}>`, "gi"))].map(match => match[1]);
}

export function looksLikeRss(xml: string) { return /<rss[\s>]|<channel[\s>]/i.test(xml.slice(0, 2000)); }

export function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function httpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}
