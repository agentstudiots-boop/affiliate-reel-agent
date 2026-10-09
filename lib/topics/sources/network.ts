import { tavilySearch, TavilyHttpError } from "../../tavily";
import { httpError, SourceError, type SourceContext, type TopicSource } from "../resilience";
import type { RawSignal } from "../schema";
import { publisherHost } from "../publishers";
import { decodeXml, httpsUrl, isoDate, looksLikeRss, rssBlocks, tagAttribute, tagText } from "./rss";

// Network trend sources. Each one is independent; a failure is isolated by runSource().
// None of them produces content, calls a generative model or a media provider.

const USER_AGENT = "affiliate-reel-agent-topic-scout/1.0 (+https://vercel.com)";
const clip = (value: string, length: number) => value.length > length ? `${value.slice(0, length - 1)}…` : value;
const rankStrength = (index: number, total: number, ceiling = 0.8) => Math.max(0.05, Math.round(ceiling * (1 - index / Math.max(1, total)) * 100) / 100);

// Several queries inside one source: partial success counts; only if every query fails, the source fails.
async function settleQueries<T>(work: Promise<T[]>[]): Promise<T[]> {
  const settled = await Promise.allSettled(work);
  const ok = settled.filter((item): item is PromiseFulfilledResult<T[]> => item.status === "fulfilled");
  if (!ok.length) throw (settled.find(item => item.status === "rejected") as PromiseRejectedResult | undefined)?.reason ?? new SourceError("unknown");
  return ok.flatMap(item => item.value);
}

const TAVILY_QUERIES = [
  { query: "aktuelle Nachrichten Deutschland Verbraucher Alltag diese Woche", tags: ["alltag"] },
  { query: "neue Filme Serien Streaming Start diese Woche Deutschland", tags: ["entertainment"] },
  { query: "kuriose Meldung Deutschland ungewöhnlich", tags: ["kurios"] },
  { query: "Wetter Deutschland Wochenende Prognose Herbst Winter Sommer", tags: ["wetter"] },
  { query: "Haushalt Tipps Trend viral Ordnung Küche Reinigung", tags: ["haushalt"] },
];

export function tavilyNewsSource(search: typeof tavilySearch = tavilySearch): TopicSource {
  return {
    id: "tavily_news",
    configured: () => !!process.env.TAVILY_API_KEY?.trim(),
    async fetch({ now, signal, request }: SourceContext) {
      const fetchedAt = now.toISOString();
      return settleQueries(TAVILY_QUERIES.map(async ({ query, tags }) => {
        let results: Awaited<ReturnType<typeof tavilySearch>>;
        try { results = await search({ query, topic: "news", days: 3, maxResults: 6, request, signal }); }
        catch (error) {
          if (error instanceof TavilyHttpError) {
            throw httpError(new Response(null, { status: error.status, headers: error.retryAfter ? { "retry-after": error.retryAfter } : {} }));
          }
          throw error;
        }
        return results.flatMap((result, index): RawSignal[] => {
          const url = httpsUrl(result.url);
          if (!url || !result.title) return [];
          return [{ source: "tavily_news", kind: "news", title: clip(decodeXml(result.title), 300), snippet: clip(decodeXml(result.content || ""), 600), url,
            publisher: publisherHost(null, url), publisherUrl: null, publishedAt: isoDate(result.publishedDate), eventDate: null, fetchedAt,
            strength: rankStrength(index, results.length, 0.6), tags }];
        });
      }));
    },
  };
}

const NEWS_FEEDS = [
  { url: "https://news.google.com/rss?hl=de&gl=DE&ceid=DE:de", tags: ["top"] },
  { url: "https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=de&gl=DE&ceid=DE:de", tags: ["entertainment"] },
  { url: "https://news.google.com/rss/search?q=Haushalt+OR+Verbraucher+OR+Alltag+when:3d&hl=de&gl=DE&ceid=DE:de", tags: ["alltag"] },
];

async function readFeed(url: string, { signal, request }: SourceContext) {
  const response = await request(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml;q=0.9" }, signal, redirect: "follow", cache: "no-store" });
  if (!response.ok) throw httpError(response);
  const xml = await response.text();
  if (!looksLikeRss(xml)) throw new SourceError("invalid_response");
  return xml;
}

export function googleNewsRssSource(): TopicSource {
  return {
    id: "google_news_rss",
    configured: () => process.env.TOPIC_SOURCE_GOOGLE_NEWS !== "false",
    async fetch(context) {
      const fetchedAt = context.now.toISOString();
      return settleQueries(NEWS_FEEDS.map(async feed => {
        const items = rssBlocks(await readFeed(feed.url, context)).slice(0, 15);
        return items.flatMap((item, index): RawSignal[] => {
          const rawTitle = tagText(item, "title");
          const link = httpsUrl(tagText(item, "link"));
          if (!rawTitle || !link) return [];
          const sourceName = tagText(item, "source");
          const sourceUrl = httpsUrl(tagAttribute(item, "source", "url"));
          // Google News titles end with " - Publisher".
          const title = sourceName && rawTitle.endsWith(` - ${sourceName}`) ? rawTitle.slice(0, -(sourceName.length + 3)) : rawTitle;
          return [{ source: "google_news_rss", kind: "news", title: clip(title, 300), snippet: "", url: link, publisher: publisherHost(sourceName, sourceUrl),
            publisherUrl: sourceUrl, publishedAt: isoDate(tagText(item, "pubDate")), eventDate: null, fetchedAt, strength: rankStrength(index, items.length, 0.6), tags: feed.tags }];
        });
      }));
    },
  };
}

// Google Trends "Trending now" RSS: the publicly offered feed of trending searches with related news links.
// There is no official Google Trends API for this; the feed is used as one signal among several, never alone.
export function googleTrendsRssSource(): TopicSource {
  return {
    id: "google_trends_rss",
    configured: () => process.env.TOPIC_SOURCE_GOOGLE_TRENDS !== "false",
    async fetch(context) {
      const fetchedAt = context.now.toISOString();
      const items = rssBlocks(await readFeed("https://trends.google.com/trending/rss?geo=DE", context)).slice(0, 20);
      const traffic = items.map(item => Number((tagText(item, "ht:approx_traffic") || "").replace(/[^\d]/g, "")) || 0);
      const top = Math.max(1, ...traffic);
      return items.flatMap((item, index): RawSignal[] => {
        const keyword = tagText(item, "title");
        if (!keyword || keyword.length < 3) return [];
        const publishedAt = isoDate(tagText(item, "pubDate"));
        // Log scale: 2000+ vs 200000+ searches differ, but not linearly in editorial weight.
        const strength = traffic[index] ? Math.max(0.1, Math.round(Math.log10(traffic[index] + 1) / Math.log10(top + 1) * 90) / 100) : rankStrength(index, items.length, 0.5);
        const search: RawSignal = { source: "google_trends_rss", kind: "search", title: clip(keyword, 300), snippet: traffic[index] ? `ca. ${traffic[index]}+ Suchanfragen` : "",
          url: null, publisher: "trends.google.com", publisherUrl: null, publishedAt, eventDate: null, fetchedAt, strength, tags: [clip(keyword, 40)] };
        const news = rssBlocks(item, "ht:news_item").slice(0, 3).flatMap((block): RawSignal[] => {
          const title = tagText(block, "ht:news_item_title");
          const url = httpsUrl(tagText(block, "ht:news_item_url"));
          if (!title || !url) return [];
          return [{ source: "google_trends_rss", kind: "news", title: clip(title, 300), snippet: "", url, publisher: publisherHost(tagText(block, "ht:news_item_source"), url),
            publisherUrl: null, publishedAt, eventDate: null, fetchedAt, strength: Math.round(strength * 0.8 * 100) / 100, tags: [clip(keyword, 40)] }];
        });
        return [search, ...news];
      });
    },
  };
}

const NON_ARTICLE = /^(Hauptseite|Spezial:|Datei:|Wikipedia:|Benutzer:|Portal:|Hilfe:|Kategorie:|Vorlage:|-$)/;
// Wikimedia REST API (official, keyless): most viewed German Wikipedia articles of the previous day.
// An attention signal only: it says people look something up, not what happened.
export function wikipediaPageviewsSource(): TopicSource {
  return {
    id: "wikipedia_pageviews",
    configured: () => process.env.TOPIC_SOURCE_WIKIPEDIA !== "false",
    async fetch({ now, signal, request }) {
      const fetchedAt = now.toISOString();
      for (const daysBack of [1, 2]) {
        const day = new Date(now.getTime() - daysBack * 86_400_000);
        const path = `${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, "0")}/${String(day.getUTCDate()).padStart(2, "0")}`;
        const response = await request(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/de.wikipedia/all-access/${path}`,
          { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal, cache: "no-store" });
        if (response.status === 404 && daysBack === 1) continue; // data for yesterday not published yet
        if (!response.ok) throw httpError(response);
        const body = await response.json() as { items?: { articles?: { article?: unknown; views?: unknown; rank?: unknown }[] }[] };
        const articles = (body.items?.[0]?.articles ?? []).filter(item => typeof item.article === "string" && !NON_ARTICLE.test(item.article)).slice(0, 15);
        if (!Array.isArray(body.items)) throw new SourceError("invalid_response");
        return articles.map((item, index): RawSignal => {
          const article = String(item.article);
          return { source: "wikipedia_pageviews", kind: "attention", title: clip(article.replace(/_/g, " "), 300), snippet: typeof item.views === "number" ? `${item.views} Aufrufe am ${path.replace(/\//g, "-")}` : "",
            url: `https://de.wikipedia.org/wiki/${encodeURIComponent(article)}`, publisher: "de.wikipedia.org", publisherUrl: null, publishedAt: null,
            eventDate: null, fetchedAt, strength: rankStrength(index, articles.length, 0.6), tags: [] };
        });
      }
      return [];
    },
  };
}
