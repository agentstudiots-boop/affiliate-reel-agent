// Source quality is a coarse editorial classification of the publisher, not a truth verdict.
// reputable: established newsrooms, public broadcasters, official bodies. boulevard: tabloid / gossip focus.
// Unknown publishers are neither trusted nor rejected; sensitive claims from them need corroboration.

const REPUTABLE = [
  "tagesschau.de", "zdf.de", "zdfheute.de", "ard.de", "br.de", "ndr.de", "wdr.de", "mdr.de", "swr.de", "hr.de", "rbb24.de", "sr.de", "dw.com", "deutschlandfunk.de",
  "spiegel.de", "zeit.de", "faz.net", "sueddeutsche.de", "handelsblatt.com", "tagesspiegel.de", "stern.de", "rnd.de", "n-tv.de", "welt.de", "focus.de", "t-online.de",
  "heise.de", "golem.de", "t3n.de", "chip.de", "computerbild.de", "netzwelt.de",
  "dwd.de", "wetter.de", "wetteronline.de", "verbraucherzentrale.de", "bundesregierung.de", "destatis.de", "umweltbundesamt.de", "bfr.bund.de", "bzga.de",
  "kino.de", "filmstarts.de", "moviepilot.de", "dwdl.de", "quotenmeter.de", "apa.at", "orf.at", "srf.ch", "dpa.com", "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk",
];
const BOULEVARD = ["bild.de", "promiflash.de", "gala.de", "bunte.de", "intouch.de", "tz.de", "express.de", "derwesten.de", "merkur.de", "news.de"];

export type PublisherQuality = "reputable" | "unknown" | "boulevard" | "aggregator";

export function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try { return new URL(value).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return value.toLowerCase().replace(/^www\./, "").trim() || null; }
}

const matches = (host: string, list: string[]) => list.some(domain => host === domain || host.endsWith(`.${domain}`));

export function publisherQuality(hostOrUrl: string | null | undefined): PublisherQuality {
  const host = hostOf(hostOrUrl);
  if (!host) return "unknown";
  if (matches(host, REPUTABLE)) return "reputable";
  if (matches(host, BOULEVARD)) return "boulevard";
  if (/(^|\.)news\.google\.com$|(^|\.)trends\.google\.com$/.test(host)) return "aggregator";
  return "unknown";
}

// Publisher names in feeds ("tagesschau.de", "Der Spiegel") are mapped to hosts where obvious.
const NAME_TO_HOST: [RegExp, string][] = [
  [/tagesschau/i, "tagesschau.de"], [/\bzdf/i, "zdf.de"], [/spiegel/i, "spiegel.de"], [/\bzeit\b/i, "zeit.de"], [/faz|frankfurter allgemeine/i, "faz.net"],
  [/s(ü|ue)ddeutsche/i, "sueddeutsche.de"], [/\bstern\b/i, "stern.de"], [/n-tv/i, "n-tv.de"], [/\bwelt\b/i, "welt.de"], [/focus/i, "focus.de"],
  [/heise/i, "heise.de"], [/\bbild\b/i, "bild.de"], [/promiflash/i, "promiflash.de"], [/t-online/i, "t-online.de"], [/\bbr24|bayerischer rundfunk/i, "br.de"],
  [/\bndr\b/i, "ndr.de"], [/\bwdr\b/i, "wdr.de"], [/\bmdr\b/i, "mdr.de"], [/\bswr\b/i, "swr.de"], [/deutschlandfunk/i, "deutschlandfunk.de"], [/kino\.de/i, "kino.de"],
];
export function publisherHost(name: string | null | undefined, url?: string | null): string | null {
  const fromUrl = hostOf(url);
  if (fromUrl && publisherQuality(fromUrl) !== "aggregator") return fromUrl;
  if (!name) return fromUrl;
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name.trim())) return name.trim().toLowerCase().replace(/^www\./, "");
  return NAME_TO_HOST.find(([pattern]) => pattern.test(name))?.[1] ?? name.trim().toLowerCase();
}
