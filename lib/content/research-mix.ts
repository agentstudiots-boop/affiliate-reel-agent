// Shared research of the trend scout: product chances (unchanged default) plus, behind feature flags,
//   TRENDSCOUT_TOPICS=on       – general topic research (Haushaltstipps, Alltagstricks, Home & Living, Kurioses, Wissen)
//                                in the SAME discovery run (same evidence, same model call). Topic chances go to Jarvis/Trendsetter.
//   PRODUCT_MIX=balance        – Jarvis orders the already gate-approved product chances so that the price tiers
//                                (low/mid/high) approach a configurable target mix. It never adds, invents or unlocks candidates.
// Both flags default to off: the productive trend scout behaves exactly as before (rollback = unset the variable).
// Price tiers are planning estimates of a PRODUCT TYPE (never a price claim, never shown in a post).

export type Env = Record<string, string | undefined>;
export type PriceTier = "low" | "mid" | "high";
export const PRICE_TIERS: readonly PriceTier[] = ["low", "mid", "high"];

export function trendscoutTopicsEnabled(env: Env = process.env) {
  return env.TRENDSCOUT_TOPICS?.trim().toLowerCase() === "on";
}

export type ProductMixConfig = { enabled: boolean; limits: { lowMax: number; midMax: number }; target: Record<PriceTier, number>; window: number };
const DEFAULT_TARGET: Record<PriceTier, number> = { low: 40, mid: 35, high: 25 };

// PRODUCT_PRICE_TIER_LIMITS="30,150" (EUR, typical price of the product type), PRODUCT_MIX_TARGET="low:40,mid:35,high:25",
// PRODUCT_MIX_WINDOW=12 (recent automatic products considered). Invalid values fall back to the defaults.
export function productMixConfig(env: Env = process.env): ProductMixConfig {
  const enabled = env.PRODUCT_MIX?.trim().toLowerCase() === "balance";
  const [lowMax, midMax] = (env.PRODUCT_PRICE_TIER_LIMITS ?? "").split(",").map(value => Number(value.trim()));
  const limits = Number.isFinite(lowMax) && Number.isFinite(midMax) && lowMax > 0 && midMax > lowMax ? { lowMax, midMax } : { lowMax: 30, midMax: 150 };
  const target = { ...DEFAULT_TARGET };
  const parsed: Partial<Record<PriceTier, number>> = {};
  for (const part of (env.PRODUCT_MIX_TARGET ?? "").split(",")) {
    const [key, value] = part.split(":").map(item => item.trim());
    if ((PRICE_TIERS as string[]).includes(key) && Number.isFinite(Number(value)) && Number(value) >= 0) parsed[key as PriceTier] = Number(value);
  }
  const sum = PRICE_TIERS.reduce((total, tier) => total + (parsed[tier] ?? 0), 0);
  if (PRICE_TIERS.every(tier => parsed[tier] !== undefined) && sum > 0) for (const tier of PRICE_TIERS) target[tier] = (parsed[tier]! / sum) * 100;
  const window = Number(env.PRODUCT_MIX_WINDOW);
  return { enabled, limits, target, window: Number.isInteger(window) && window >= 4 && window <= 50 ? window : 12 };
}

// Deterministic estimate of the typical price tier of a product TYPE from its name (no price data is read or invented).
// Unknown types return null and are treated neutrally.
const HIGH = /saugroboter|robot.*(saug|vacuum)|wischroboter|kaffeevollautomat|vollautomat|siebtraeger|espressomaschine|kuechenmaschine|thermomix|akkusauger|nass.?trocken.?sauger|waschtrockner|geschirrspueler|kuehlschrank|luftreiniger|klimageraet|mähroboter|maehroboter|rasenroboter|beamer|projektor 4k|fernseher|smart.?home.?(zentrale|set)|e-bike|massagesessel/;
const MID = /heissluftfritteuse|airfryer|standmixer|mixer|stabmixer|handmixer|wasserkocher|toaster|dampfbuegel|buegeleisen|dampfgarer|kontaktgrill|waffeleisen|reiskocher|milchaufschaeumer|entsafter|slow.?juicer|zahnbuerste elektrisch|elektrische zahnbuerste|haartrockner|glaetteisen|smart.?(lampe|steckdose|thermostat)|ventilator|heizluefter|luftbefeuchter|bettdecke|kopfkissen|topfset|pfannenset|messerset|gusseisen|bratpfanne|kochtopf|vakuumierer|sous.?vide|kuechenwaage smart|staubsauger/;
const LOW = /buerste|schwamm|tuch|reibe|schaeler|schere|clip|haken|organizer|halter|dose|box|beutel|matte|untersetzer|ausstecher|backform|loeffel|zange|abzieher|kerze|lichterkette|deko|aufkleber|spiel|karten|gadget|messbecher|trichter|sieb|stopfen|verschluss/;

const normalize = (value: string) => value.toLocaleLowerCase("de-DE").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .normalize("NFKD").replace(/\p{M}/gu, "");

export function priceTierOf(name: string | null | undefined): PriceTier | null {
  if (!name) return null;
  const s = normalize(name);
  if (HIGH.test(s)) return "high";
  if (MID.test(s)) return "mid";
  if (LOW.test(s)) return "low";
  return null;
}

export type MixState = { counts: Record<PriceTier, number>; known: number; deficit: Record<PriceTier, number> };

// Share of each tier among the recent automatic products vs. the target (percentage points; positive = under-represented).
export function mixState(recentNames: (string | null | undefined)[], config: ProductMixConfig): MixState {
  const counts: Record<PriceTier, number> = { low: 0, mid: 0, high: 0 };
  for (const name of recentNames.slice(0, config.window)) { const tier = priceTierOf(name); if (tier) counts[tier]++; }
  const known = counts.low + counts.mid + counts.high;
  const deficit = Object.fromEntries(PRICE_TIERS.map(tier => [tier, config.target[tier] - (known ? (counts[tier] / known) * 100 : config.target[tier])])) as Record<PriceTier, number>;
  return { counts, known, deficit };
}

export type MixCandidate = { name: string; priority: number; priceTier?: PriceTier | null };
export type MixDecision = { name: string; tier: PriceTier | null; priority: number; adjusted: number; reason: string };

// Re-orders gate-approved candidates (lower priority value = stronger). A tier that is clearly under-represented
// (deficit ≥ 10 points) gains at most one rank step, an over-represented one loses at most one: the content chance stays
// the main criterion, the mix only breaks near-ties. Returns the order plus a traceable reason for every candidate.
export function balanceByPriceTier<T extends MixCandidate>(candidates: T[], state: MixState): { ordered: T[]; decisions: MixDecision[] } {
  const decisions: MixDecision[] = [];
  const scored = candidates.map((candidate, index) => {
    const tier = candidate.priceTier ?? priceTierOf(candidate.name);
    let adjusted = candidate.priority, reason = "Preissegment unbekannt – neutral";
    if (tier) {
      const deficit = state.deficit[tier];
      if (deficit >= 10) { adjusted -= 1; reason = `Segment ${tier} unterrepräsentiert (${Math.round(deficit)} Punkte unter Ziel) – ein Rang nach vorn`; }
      else if (deficit <= -10) { adjusted += 1; reason = `Segment ${tier} überrepräsentiert (${Math.round(-deficit)} Punkte über Ziel) – ein Rang zurück`; }
      else reason = `Segment ${tier} im Zielkorridor`;
    }
    decisions.push({ name: candidate.name, tier, priority: candidate.priority, adjusted, reason });
    return { candidate, index, adjusted };
  });
  const ordered = scored.sort((a, b) => a.adjusted - b.adjusted || a.candidate.priority - b.candidate.priority || a.index - b.index).map(item => item.candidate);
  return { ordered, decisions };
}

// Additional research directions for topic chances (only with TRENDSCOUT_TOPICS=on).
export function topicResearchDirections(monthName: string, occasion: string) {
  return [
    { direction: "alltagstipps", query: `Haushaltstipps Alltagstricks Ordnung Putzen Wohnen einfache Lösungen ${monthName} Deutschland`, timeRange: "month" as const },
    { direction: "wissen_kurios", query: `überraschendes Alltagswissen kuriose Fakten Haushalt Wohnen ${occasion} Trend Deutschland`, timeRange: "month" as const },
  ];
}

export const TOPIC_INSTRUCTION = `
ZUSÄTZLICH (Themenrecherche aktiv): Schlage zusätzlich bis zu zwei allgemeine Themen-Chancen (kind=topic_opportunity, productIdea=null) für die Marke „Alltäglich leichter“ vor: Haushaltstipps, Alltagserleichterungen, Home & Living, praktische Alltagstricks, saisonale Themen, interessante Informationen oder kuriose Entdeckungen aus dem Alltag. Ziel ist Reichweite und Vertrauen, ein Produktlink ist dafür nicht nötig. Jede Themen-Chance braucht einen konkreten Nutzen oder Aha-Effekt für die Zielgruppe und mindestens eine passende Quelle aus evidence; keine erfundenen Studien, Zahlen oder Gesundheitsversprechen. Produkt-Chancen bleiben gleichberechtigt; Themen verdrängen keine starken Produkt-Chancen.`;

export const mixInstruction = (config: ProductMixConfig, state: MixState) => `
ZUSÄTZLICH (Produktmix aktiv): Gib bei jeder Produkt-Chance priceTier an – das typische Preissegment dieses Produkttyps als Schätzung: low (bis ca. ${config.limits.lowMax} €), mid (bis ca. ${config.limits.midMax} €), high (darüber). Das ist eine interne Planungsangabe, niemals ein Preis im Beitrag. Gib außerdem purchaseIntent (low/medium/high) an: wie wahrscheinlich ein Kauf nach dem Beitrag ist (Nutzen, Problemdruck, Nachfrage). Teuer ist nicht automatisch besser. Zielmix: low ${Math.round(config.target.low)} %, mid ${Math.round(config.target.mid)} %, high ${Math.round(config.target.high)} %; zuletzt: low ${state.counts.low}, mid ${state.counts.mid}, high ${state.counts.high}. Berücksichtige unterrepräsentierte Segmente, wenn die Content-Chance dort stark ist (z. B. Saugroboter, Kaffeevollautomaten, Premium-Küchengeräte, smarte Haushaltsgeräte für high).`;
