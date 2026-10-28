import { switchOn } from "../config/rollout";
import type { SelectionHistory } from "../content/strategy";
import { UNSUPPORTED_CLAIM_PATTERN } from "../content/trend";
import { applyRevision, topicGate, type GateCheck, type TopicGateVerdict } from "../topics/gate";
import type { TopicHistoryEntry } from "../topics/history";
import { buildCandidate } from "../topics/scout";
import type { RawSignal, TopicCandidate } from "../topics/schema";
import { classifyWhatsAppReply } from "../whatsapp/intent";

// Explicit operator topic orders over WhatsApp („Mach etwas über Herbstmüdigkeit“, „Thema: Laub im Garten“, „Erstelle einen
// Beitrag zum Thema Lüften“). Only clear phrasings are recognised; product orders („Erstelle einen Beitrag zum Roborock …“)
// stay with manual-order.ts. Like a product order, the operator's wish only overrides the editorial selection (brand-fit and
// relevance thresholds, usefulness, repetition cooldown) – never the protective checks (facts, risk, gossip, unsupported
// claims, plus: no sensitive topic without sources) and never an approval: the result is an ordinary topic proposal that needs „Freigeben“ twice.

export type TopicOrder = { topic: string };

const VERB = "(?:bitte\\s+)?(?:mach|mache|erstell|erstelle|schreib|schreibe)\\s+(?:mir\\s+|uns\\s+)?(?:bitte\\s+)?(?:doch\\s+)?(?:mal\\s+)?";
const ABOUT = "(?:über|zu|zum|zur|rund\\s+um)";
const PATTERNS = [
  new RegExp(`^(?:neues\\s+)?(?:thema|themenbeitrag|themenpost|themenvorschlag|themenidee)\\s*[:–-]\\s*(.+)$`, "i"),
  new RegExp(`^${VERB}(?:etwas|was)\\s+${ABOUT}\\s+(.+)$`, "i"),
  new RegExp(`^${VERB}(?:einen?|ein)\\s+(?:neuen?\\s+)?(?:themenbeitrag|themenpost|themenvorschlag)\\s+${ABOUT}\\s+(.+)$`, "i"),
  new RegExp(`^${VERB}(?:einen?|ein)\\s+(?:neuen?\\s+)?(?:beitrag|post|bildpost|reel|video)\\s+(?:zum|über\\s+das)\\s+thema\\s+(.+)$`, "i"),
];

function topicName(raw: string): string | null {
  const topic = raw.trim().replace(/^(?:das\s+thema|thema)\s+/i, "").replace(/\s+(?:bitte|mal|doch)$/i, "").replace(/^[„"']|[“"']$/g, "").trim();
  if (topic.length < 3 || topic.length > 120 || topic.split(/\s+/).length > 15) return null;
  if (/https?:\/\/|www\./i.test(topic)) return null;
  return /^[\p{L}\p{N}][\p{L}\p{N}\s.,:;+&/'’()–-]*$/u.test(topic) ? topic : null;
}

export function topicOrderCommand(body: string): TopicOrder | null {
  if (body.includes("?")) return null; // questions never start an order
  if (classifyWhatsAppReply(body).intent !== "changes_requested") return null; // approval words keep their meaning
  const text = body.trim().replace(/[.!]+$/, "").replace(/\s+/g, " ");
  if (text.length > 200) return null;
  for (const pattern of PATTERNS) {
    const match = text.match(pattern);
    if (match) { const topic = topicName(match[1]); return topic ? { topic } : null; }
  }
  return null;
}

// The operator's topic as a single curated signal: no external claim (fact status "not applicable"), strength unknown (0).
export function operatorTopicCluster(topic: string, now: Date): { title: string; signals: RawSignal[] } {
  const title = topic.charAt(0).toUpperCase() + topic.slice(1);
  return { title, signals: [{ source: "operator_request", kind: "evergreen", title, snippet: "", url: null, publisher: null, publisherUrl: null,
    publishedAt: null, eventDate: null, fetchedAt: now.toISOString(), strength: 0, tags: ["betreiberwunsch"] }] };
}

// Checks the operator's explicit wish cannot override.
const PROTECTIVE: GateCheck[] = ["facts", "risk", "gossip", "unsupported_claims"];
export const MAX_ORDER_VARIANTS = 2;

export type OperatorTopicResult =
  | { status: "accepted"; candidate: TopicCandidate; cluster: { title: string; signals: RawSignal[] }; verdict: TopicGateVerdict; waived: string[] }
  | { status: "rejected"; reasons: string[] };

export function operatorTopicCandidate(topic: string, context: { now: Date; history?: TopicHistoryEntry[]; productHistory?: SelectionHistory }): OperatorTopicResult {
  const cluster = operatorTopicCluster(topic, context.now);
  let last: TopicGateVerdict | null = null;
  for (let variant = 0; variant <= MAX_ORDER_VARIANTS; variant++) {
    const built = buildCandidate(cluster, context.now, variant);
    if ("error" in built) return { status: "rejected", reasons: [`Thema nicht verarbeitbar (${built.error})`] };
    // A scheduled sensitive topic is backed by sources; an order has none. Health, money, law and politics are never
    // written from a bare keyword (no healing or financial promises, AGENTS.md).
    if (built.sensitive) return { status: "rejected", reasons: [`Sensibles Thema (${built.scores.risk.factors.filter(Boolean)[0] ?? "Gesundheit, Geld, Recht oder Politik"}) braucht belegte Quellen, als Themenauftrag ohne Quelle nicht möglich`] };
    const verdict = topicGate(built, context);
    last = verdict;
    const failed = PROTECTIVE.filter(check => !verdict.checks[check].passed);
    // Unsupported claims in our own template texts can be fixed by another variant; in the operator's title they cannot.
    if (failed.length === 1 && failed[0] === "unsupported_claims" && !UNSUPPORTED_CLAIM_PATTERN.test(built.title)) continue;
    if (failed.length) return { status: "rejected", reasons: failed.map(check => verdict.checks[check].note) };
    const waived = (Object.keys(verdict.checks) as GateCheck[]).filter(check => !PROTECTIVE.includes(check) && check !== "tone" && !verdict.checks[check].passed)
      .map(check => verdict.checks[check].note);
    // Sensational wording is still toned down, exactly as for scheduled topics.
    const candidate = applyRevision(built, { ...verdict, decision: verdict.revised ? "revise" : verdict.decision });
    return { status: "accepted", candidate: { ...candidate, why_now: "Dein Themenauftrag per WhatsApp." }, cluster, verdict, waived };
  }
  return { status: "rejected", reasons: last ? PROTECTIVE.filter(check => !last!.checks[check].passed).map(check => last!.checks[check].note) : ["Thema nicht verarbeitbar"] };
}

// Own switch through lib/config/rollout.ts (rollout value, the environment wins; "false" is the emergency stop). Only effective
// together with TOPIC_PIPELINE_ENABLED=true.
export const topicOrdersEnabled = (env: Record<string, string | undefined> = process.env) => switchOn("TOPIC_ORDERS_ENABLED", env);

// Explicit topic orders per Berlin calendar day (default 5, at most 10): every order can cost up to four model calls.
export const dailyTopicOrderLimit = (env: Record<string, string | undefined> = process.env) => {
  const value = Math.floor(Number(env.TOPIC_ORDERS_PER_DAY));
  return Number.isFinite(value) && value >= 1 ? Math.min(10, value) : 5;
};
