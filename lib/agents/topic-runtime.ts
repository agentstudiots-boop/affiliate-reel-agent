import { seedIdeas, scoutProducts } from "@/lib/agents/product-scout";
import { amazonProduct } from "@/lib/amazon";
import { createGenerator } from "@/lib/content/model";
import { defaultPublishers } from "@/lib/distribution/publishers";
import { getDatabase } from "@/lib/memory/db";
import { findAmazonProduct } from "@/lib/product-resolver";
import type { ProductSuggester, ProductSuggestion } from "@/lib/topic-pipeline/product-coupling";
import type { TopicPipelineDeps } from "@/lib/topic-pipeline/orchestrator";
import { tokens } from "@/lib/topics/lexicon";
import { postgresLedger } from "@/lib/visual/ledger";
import { createHeyGenAvatarProvider, heygenConfig } from "@/lib/visual/providers/heygen";
import { createReplicateBriefProvider } from "@/lib/visual/providers/replicate";
import { createRunwayStandardVideoProvider } from "@/lib/visual/providers/runway-video";
import { postgresQuota } from "@/lib/visual/video";
import { sendWhatsAppText } from "@/lib/whatsapp/client";

// Production wiring of the topic pipeline (app layer). Tests inject their own dependencies instead.

// Topic category hints (controlled taxonomy keys) → categories used by the existing product trend scout seeds.
const CATEGORY_MATCH: Record<string, string[]> = {
  kitchen: ["Küche", "Haushalt"], cooking_baking: ["Backen", "Küche"], household: ["Haushalt", "Bad", "Wohnen"], decor: ["Wohnen", "Halloween", "Weihnachten"],
  outdoor: ["Garten", "Grillen", "Sommer"], technology: ["Wohnen"], home_living: ["Wohnen", "Haushalt"], leisure: ["Geschenke", "Unterwegs"], seasonal: ["Halloween", "Weihnachten", "Sommer"],
};

// The existing product trend scout (seed pool incl. seasonal ideas and content chances) ranks candidates for a topic.
// With an explicit wish ("…wie eine Heizdecke") its targeted search path is used. Always at most three.
export const topicProductSuggester: ProductSuggester = async (topic, wish) => {
  if (wish) {
    const targeted = await scoutProducts(wish);
    return targeted.output.candidates.slice(0, 1).map(item => ({ name: item.name, category: item.category, searchQuery: item.searchQuery,
      reason: `Dein Wunsch zum Thema „${topic.title}“; Eignung wird an der konkreten Amazon-Seite geprüft.` }));
  }
  const topicWords = new Set(tokens(`${topic.title} ${topic.audience_problem} ${topic.angle}`));
  const categories = topic.possible_product_category ? CATEGORY_MATCH[topic.possible_product_category] ?? [] : [];
  const ranked = seedIdeas(new Date()).map(seed => {
    const words = tokens(`${seed.name} ${seed.whyNow} ${seed.reelIdea} ${seed.targetGroup}`);
    const overlap = words.filter(word => topicWords.has(word)).length;
    const score = overlap * 2 + (categories.includes(seed.category) ? 3 : 0);
    return { seed, score };
  }).filter(item => item.score >= 3).sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: ProductSuggestion[] = [];
  for (const { seed } of ranked) {
    if (seen.has(seed.name) || out.length >= 3) continue;
    seen.add(seed.name);
    out.push({ name: seed.name, category: seed.category, searchQuery: seed.searchQuery,
      reason: `${seed.whyNow} Anwendung: ${seed.reelIdea}`.replace(/\s+/g, " ").slice(0, 220) });
  }
  return out;
};

export async function resolveTopicProduct(query: string) {
  const product = await findAmazonProduct(query, query, "Menschen mit passender Alltagssituation");
  const identity = amazonProduct(product.sourceUrl);
  if (!identity || !product.affiliateUrl) return null;
  return { name: product.name, asin: identity.asin, affiliateUrl: product.affiliateUrl, sourceUrl: product.sourceUrl };
}

export function topicPipelineDeps(): TopicPipelineDeps {
  const db = getDatabase();
  const limit = heygenConfig().monthlyLimit;
  return {
    db,
    send: async text => String(await sendWhatsAppText(text)),
    trustedWaId: process.env.WHATSAPP_APPROVER_WA_ID || "",
    render: { ledger: postgresLedger(db), imageProvider: createReplicateBriefProvider(), avatarProvider: createHeyGenAvatarProvider(),
      standardVideoProvider: createRunwayStandardVideoProvider(), avatarQuota: limit > 0 ? { store: postgresQuota(db), limit } : null },
    // Reference mode by default (no model cost). AI copy only with TOPIC_COPY_MODE=ai and a Replicate token.
    generate: process.env.TOPIC_COPY_MODE === "ai" && process.env.REPLICATE_API_TOKEN?.trim() ? createGenerator({ mode: "ai" }) : null,
    publishers: defaultPublishers(),
    suggester: topicProductSuggester,
    resolveProduct: query => resolveTopicProduct(query).catch(() => null),
  };
}
