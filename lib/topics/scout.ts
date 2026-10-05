import { createHash, randomUUID } from "node:crypto";
import { emitEvent } from "../observability/events";
import { topicTexts } from "./angles";
import { evaluateHistory, type TopicHistoryEntry } from "./history";
import { jaccard, sharedCount, tokens } from "./lexicon";
import { runSource, type RetryPolicy, type TopicSource } from "./resilience";
import { classifyTrend, scoreCluster, type Cluster } from "./scoring";
import { topicCandidateSchema, type RawSignal, type ScoutResult, type SourceHealth, type TopicCandidate } from "./schema";
import { googleNewsRssSource, googleTrendsRssSource, tavilyNewsSource, wikipediaPageviewsSource } from "./sources/network";
import { calendarSource, evergreenSource } from "./sources/offline";
import type { SelectionHistory } from "../content/strategy";

// Topic scout: find, cluster, classify and score topic candidates. It recommends a format but never produces:
// no image/video provider, no publishing, no WhatsApp. Any source can fail; offline sources keep it alive.

export function defaultTopicSources(): TopicSource[] {
  return [tavilyNewsSource(), googleNewsRssSource(), googleTrendsRssSource(), wikipediaPageviewsSource(), calendarSource(), evergreenSource()];
}

const MAX_NEWS_AGE_DAYS = 30;

export function conceptKey(title: string) {
  const significant = [...new Set(tokens(title))].sort((a, b) => b.length - a.length).slice(0, 4).sort();
  return significant.join("-").slice(0, 80) || "thema";
}
// Stable across runs and signal order: offline/search titles are canonical; for news clusters the words shared by
// most headlines form the key, so re-ordered or additional headlines map to the same topic_id.
export function clusterConcept(cluster: Cluster) {
  const canonical = cluster.signals.find(signal => signal.kind !== "news");
  const news = cluster.signals.filter(signal => signal.kind === "news");
  if (canonical || news.length < 2) return conceptKey(canonical?.title ?? cluster.title);
  const counts = new Map<string, number>();
  for (const signal of news) for (const token of new Set(tokens(signal.title))) counts.set(token, (counts.get(token) ?? 0) + 1);
  const shared = [...counts].filter(([, count]) => count >= Math.max(2, Math.ceil(news.length / 2)))
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0])).slice(0, 4).map(([token]) => token).sort();
  return shared.length >= 2 ? shared.join("-").slice(0, 80) : conceptKey(cluster.title);
}
export const topicIdFor = (concept: string) => `tp_${createHash("sha256").update(concept).digest("hex").slice(0, 16)}`;

// Greedy clustering: signals about the same thing (shared trend keyword tag or strong token overlap) merge into one topic.
export function clusterSignals(signals: RawSignal[]): Cluster[] {
  const clusters: { tokens: Set<string>; tags: Set<string>; signals: RawSignal[] }[] = [];
  const ordered = [...signals].sort((a, b) => (a.kind === "search" ? -1 : 0) - (b.kind === "search" ? -1 : 0) || b.strength - a.strength);
  for (const signal of ordered) {
    const own = tokens(`${signal.title}`);
    const keywordTags = signal.source === "google_trends_rss" ? signal.tags.map(tag => tag.toLowerCase()) : [];
    let best: (typeof clusters)[number] | null = null, bestScore = 0;
    for (const cluster of clusters) {
      // Offline signals never merge with each other (each curated topic is its own candidate).
      if ((signal.kind === "calendar" || signal.kind === "evergreen") && cluster.signals.some(item => item.kind === signal.kind)) continue;
      const tagMatch = keywordTags.some(tag => cluster.tags.has(tag));
      const overlap = jaccard(own, cluster.tokens);
      const shared = sharedCount(own, cluster.tokens);
      // Two shared words suffice when one of them is distinctive (long), e.g. "Zeitumstellung" or "Netflix".
      const distinctive = [...new Set(own)].filter(token => token.length >= 7 && cluster.tokens.has(token)).length;
      const value = tagMatch ? 1 : (shared >= 2 && (overlap >= 0.34 || distinctive >= 1)) || shared >= 3 ? Math.max(overlap, 0.01) : 0;
      if (value > bestScore) { best = cluster; bestScore = value; }
    }
    if (best) { best.signals.push(signal); own.forEach(token => best!.tokens.add(token)); keywordTags.forEach(tag => best!.tags.add(tag)); }
    else clusters.push({ tokens: new Set(own), tags: new Set(keywordTags), signals: [signal] });
  }
  return clusters.map(cluster => {
    const search = cluster.signals.find(signal => signal.kind === "search");
    const offline = cluster.signals.find(signal => signal.kind === "calendar" || signal.kind === "evergreen");
    const news = [...cluster.signals].filter(signal => signal.kind === "news").sort((a, b) => b.strength - a.strength || a.title.localeCompare(b.title))[0];
    return { title: (offline ?? search ?? news ?? cluster.signals[0]).title, signals: cluster.signals };
  });
}

export function buildCandidate(cluster: Cluster, now: Date, variant = 0): TopicCandidate | { error: string } {
  const { type } = classifyTrend(cluster, now);
  const scored = scoreCluster(cluster, type, now);
  const texts = topicTexts(cluster, type, scored, now, variant);
  const concept = clusterConcept(cluster);
  const signals = cluster.signals.slice().sort((a, b) => b.strength - a.strength).slice(0, 12);
  const candidate = {
    topic_id: topicIdFor(concept), concept_key: concept, title: cluster.title.slice(0, 200), trend_type: type,
    source_signals: signals.map(signal => ({ source: signal.source, kind: signal.kind, title: signal.title, url: signal.url, publisher: signal.publisher,
      published_at: signal.publishedAt, event_date: signal.eventDate, fetched_at: signal.fetchedAt, strength: signal.strength })),
    source_urls: [...new Set(signals.map(signal => signal.url).filter((url): url is string => !!url))].slice(0, 12),
    detected_at: now.toISOString(),
    relevance_score: scored.relevance, virality_score: scored.scores.virality.score, brand_fit_score: scored.scores.brand_fit.score, risk_score: scored.scores.risk.score,
    scores: scored.scores, fact_status: scored.factStatus, sensitive: scored.sensitive, gossip: scored.gossip,
    audience_problem: texts.audienceProblem.slice(0, 300), why_now: texts.whyNow.slice(0, 400), hook: texts.hook.slice(0, 200), angle: texts.angle.slice(0, 300),
    core_message: texts.coreMessage.slice(0, 400), suggested_format: scored.suggestedFormat, suitable_for_video: scored.suitableForVideo,
    suitable_for_avatar: scored.suitableForAvatar, visual_potential: scored.scores.visual.score,
    product_optional: !scored.gossip && !scored.scores.risk.factors.some(factor => factor.startsWith("Hochrisiko")), possible_product_category: scored.category,
    confidence: scored.confidence, text_origin: "rule_template" as const,
  };
  const parsed = topicCandidateSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { error: `Schema: ${parsed.error.issues[0]?.path.join(".")}` };
}

export type ScoutOptions = {
  now: Date;
  sources?: TopicSource[];
  history?: TopicHistoryEntry[];
  productHistory?: SelectionHistory;
  limit?: number;
  request?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retry?: Partial<RetryPolicy>;
  deadlineMs?: number;
};

export async function runTopicScout(options: ScoutOptions): Promise<ScoutResult> {
  const started = Date.now();
  const runId = randomUUID();
  const sources = options.sources ?? defaultTopicSources();
  emitEvent("topic_scout_started", { runId, sources: sources.map(source => source.id) });
  const deadline = AbortSignal.timeout(options.deadlineMs ?? 45_000);
  const results = await Promise.all(sources.map(source => runSource(source, { now: options.now, request: options.request, sleep: options.sleep, policy: options.retry, deadline })));
  const health: SourceHealth[] = results.map(result => result.health);
  const signals = results.flatMap(result => result.signals);
  const dropped: ScoutResult["dropped"] = [];

  // Age filter: news older than 30 days is not a current topic.
  const fresh = signals.filter(signal => {
    if (!signal.publishedAt || signal.kind !== "news") return true;
    const old = (options.now.getTime() - Date.parse(signal.publishedAt)) / 86_400_000 > MAX_NEWS_AGE_DAYS;
    if (old) dropped.push({ title: signal.title.slice(0, 80), reason: "Meldung älter als 30 Tage" });
    return !old;
  });

  const byId = new Map<string, TopicCandidate>();
  const clusters: ScoutResult["clusters"] = {};
  for (const cluster of clusterSignals(fresh)) {
    const built = buildCandidate(cluster, options.now);
    if ("error" in built) { dropped.push({ title: cluster.title.slice(0, 80), reason: built.error }); continue; }
    if (byId.has(built.topic_id)) { dropped.push({ title: built.title.slice(0, 80), reason: "Dublette im selben Lauf" }); continue; }
    const history = evaluateHistory(built, options.history ?? [], options.now, options.productHistory);
    if (history.blocked) {
      dropped.push({ title: built.title.slice(0, 80), reason: `Cooldown: ${history.reasons[0]}` });
      emitEvent("topic_candidate_rejected", { runId, topicId: built.topic_id, stage: "scout_cooldown", reason: history.reasons[0] });
      continue;
    }
    byId.set(built.topic_id, built);
    clusters[built.topic_id] = cluster;
  }
  const ranked = [...byId.values()].sort((a, b) => b.relevance_score - a.relevance_score);
  const candidates = ranked.slice(0, options.limit ?? 20);
  for (const skipped of ranked.slice(candidates.length)) dropped.push({ title: skipped.title.slice(0, 80), reason: `Unterhalb der besten ${candidates.length} Kandidaten` });
  for (const candidate of candidates) emitEvent("topic_candidate_created", { runId, topicId: candidate.topic_id, trendType: candidate.trend_type, relevance: candidate.relevance_score, risk: candidate.risk_score });

  const network = sources.filter(source => !source.offline).map(source => health.find(item => item.source === source.id)!);
  const networkOk = network.filter(item => item.status === "ok" || item.status === "empty").length;
  const anyFailed = health.some(item => item.status === "failed");
  const outcome = !candidates.length ? "no_candidates" : network.length && !networkOk ? "offline_fallback" : anyFailed ? "degraded" : "success";
  const result: ScoutResult = { runId, startedAt: options.now.toISOString(), durationMs: Date.now() - started, outcome, candidates, dropped: dropped.slice(0, 40), sourceHealth: health,
    clusters: Object.fromEntries(candidates.map(candidate => [candidate.topic_id, clusters[candidate.topic_id]])) };
  emitEvent("topic_scout_completed", { runId, outcome, candidates: candidates.length, dropped: dropped.length,
    failedSources: health.filter(item => item.status === "failed").map(item => `${item.source}:${item.errorKind}`) });
  return result;
}
