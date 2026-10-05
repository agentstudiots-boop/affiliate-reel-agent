type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
  published_date?: string;
};

// Carries the HTTP status so callers (e.g. the topic scout) can classify 401/429/5xx. Message unchanged.
export class TavilyHttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfter: string | null = null) {
    super(message);
    this.name = "TavilyHttpError";
  }
}

type TavilyResponse = {
  results?: TavilyResult[];
  detail?: string;
};

export async function tavilySearch({
  query,
  timeRange,
  maxResults = 8,
  topic = "general",
  days,
  request = fetch,
  signal,
}: {
  query: string;
  timeRange?: "day" | "week" | "month" | "year";
  maxResults?: number;
  // Additive options for the topic scout. Defaults keep the previous behaviour for existing callers.
  topic?: "general" | "news";
  days?: number;
  request?: typeof fetch;
  signal?: AbortSignal;
}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY fehlt in den Vercel-Umgebungsvariablen.");
  }

  const response = await request("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      topic,
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
      ...(timeRange ? { time_range: timeRange } : {}),
      ...(topic === "news" && days ? { days } : {}),
    }),
    cache: "no-store",
    signal: signal ?? AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as TavilyResponse;
    throw new TavilyHttpError(data.detail || `Tavily-Suche fehlgeschlagen (${response.status}).`, response.status, response.headers.get("retry-after"));
  }
  const data = (await response.json()) as TavilyResponse;

  return (data.results ?? []).map((result, index) => ({
    id: `tavily-${index + 1}`,
    title: result.title,
    url: result.url,
    content: result.content,
    score: result.score,
    publishedDate: result.published_date,
  }));
}

export function tavilyContext(
  results: Awaited<ReturnType<typeof tavilySearch>>,
) {
  return results
    .map(
      (result, index) =>
        `[Quelle ${index + 1}] ${result.title}\nURL: ${result.url}\n${result.content}`,
    )
    .join("\n\n");
}

export function tavilySources(
  results: Awaited<ReturnType<typeof tavilySearch>>,
) {
  return results.map((result) => ({
    sourceType: "url" as const,
    id: result.id,
    title: result.title,
    url: result.url,
  }));
}
