type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
};

type TavilyResponse = {
  results?: TavilyResult[];
  detail?: string;
};

export async function tavilySearch({
  query,
  timeRange,
  maxResults = 8,
}: {
  query: string;
  timeRange?: "day" | "week" | "month" | "year";
  maxResults?: number;
}) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY fehlt in den Vercel-Umgebungsvariablen.");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      topic: "general",
      search_depth: "basic",
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
      ...(timeRange ? { time_range: timeRange } : {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });

  const data = (await response.json()) as TavilyResponse;
  if (!response.ok) {
    throw new Error(data.detail || `Tavily-Suche fehlgeschlagen (${response.status}).`);
  }

  return (data.results ?? []).map((result, index) => ({
    id: `tavily-${index + 1}`,
    title: result.title,
    url: result.url,
    content: result.content,
    score: result.score,
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
