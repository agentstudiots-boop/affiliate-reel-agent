import type { LearningEvidence } from "../memory/schema";
import { createAmazonAffiliateUrl } from "../amazon";
import { creativeAgent } from "./agents/creative";
import { videoAgent } from "./agents/video";
import { imageAgent } from "./agents/image";
import { textAgent } from "./agents/text";
import { marketingAgent } from "./agents/marketing";
import { createGenerator } from "./model";
import { contentSchema, opportunitySchema, reviewSchema, type AgentName, type Content, type ContentJob, type Decision, type Idea, type JobEvent, type JobStatus, type Opportunity, type Review } from "./schema";
import type { Generator } from "./agent";

export const MAX_REVISIONS = 2;
// Only this registry/orchestrator imports specialists. New agents can be registered here.
const producers = { video: videoAgent, image: imageAgent, text: textAgent };

export function selectIdea(ideas: Idea[], opportunity: Opportunity, learning?: LearningEvidence): Decision {
  const eligible = opportunity.targetPlatform === "instagram" ? ideas.filter(i => i.format !== "text") : ideas;
  const ranking = eligible.map(idea => {
    const s = idea.scores;
    const historyAdjustment = learning?.groups.find(g => g.format === idea.format)?.adjustment || 0;
    const score = historyAdjustment + s.audience * 2 + s.credibility * 2 + s.demonstration * (opportunity.goal === "conversion" ? 4 : 1)
      + s.conversion * (opportunity.goal === "conversion" ? 2 : 1)
      + s.economy * (opportunity.budget === "low" ? 6 : opportunity.budget === "quality" ? 0 : 0.5)
      + (idea.format === "text" && opportunity.goal !== "conversion" ? 12 : 0);
    return { ideaId: idea.id, score, rationale: `${idea.rationale} Historische Anpassung: ${historyAdjustment} Punkte.` };
  }).sort((a, b) => b.score - a.score || a.ideaId.localeCompare(b.ideaId));
  const selected = ideas.find(i => i.id === ranking[0].ideaId)!;
  return { ideaId: selected.id, format: selected.format, ranking,
    reason: `${selected.rationale} Gewichtet nach Ziel (${opportunity.goal}) und Budget (${opportunity.budget}). ${learning?.summary || "Keine historischen Messwerte berücksichtigt."} Keine garantierte Conversion-Prognose.` };
}

export function inspectContent(content: Content, decision: Decision): Review {
  const issues: string[] = [];
  if (content.format !== decision.format) issues.push("Das Ergebnis hat nicht das beauftragte Format.");
  if (content.useCase.length < 12 || content.productIntegration.length < 15) issues.push("Anwendung und Produktrolle müssen konkreter werden.");
  if (content.format === "video") {
    if (content.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0) !== content.durationSeconds) issues.push("Szenendauern passen nicht zur Gesamtlänge.");
    if (content.scenes.some(scene => scene.audio.split(/\s+/).length > scene.durationSeconds * 2.8)) issues.push("Dialog oder Voiceover ist für die Szenendauer zu lang.");
  }
  if (content.format === "image" && ((content.layout === "single" && content.slides.length !== 1) || (content.layout === "carousel" && content.slides.length < 3))) issues.push("Slide-Anzahl passt nicht zum gewählten Bildformat.");
  // Only public copy; warnings/checks may legitimately quote prohibited claims.
  const copy = [content.hook, content.cta, content.format === "text" ? content.body : content.caption,
    ...(content.format === "video" ? content.scenes.map(s => s.audio) : content.format === "image" ? content.slides.map(s => s.copy) : [])].join(" ");
  if (/garantiert|immer perfekt|fünfmal länger|ich habe.{0,30}getestet/i.test(copy)) issues.push("Unbelegte Garantie oder erfundener persönlicher Test im Veröffentlichungstext.");
  return { passed: issues.length === 0, score: issues.length ? 40 : 80, issues };
}

export async function runContentJob(raw: Opportunity, options: {
  mode?: "reference" | "ai"; signal?: AbortSignal; onUpdate?: (job: ContentJob) => void | Promise<void>;
  id?: string; loadLearning?: (opportunity: Opportunity) => Promise<LearningEvidence>;
  generate?: Generator; // Dependency injection for deterministic, cost-free contract tests.
} = {}): Promise<ContentJob> {
  const opportunity = opportunitySchema.parse(raw);
  opportunity.product.affiliateUrl = createAmazonAffiliateUrl(opportunity.product.affiliateUrl || opportunity.product.sourceUrl);
  const now = new Date().toISOString();
  const job: ContentJob = { version: 1, id: options.id || crypto.randomUUID(), createdAt: now, updatedAt: now,
    status: "queued", mode: options.mode || "reference", opportunity, events: [], revisions: 0, modelCalls: 0, totalTokens: 0 };
  const emit = async (agent: AgentName, kind: JobEvent["kind"], message: string, data?: unknown) => {
    job.updatedAt = new Date().toISOString();
    job.events.push({ sequence: job.events.length + 1, at: job.updatedAt, agent, kind, message, ...(data === undefined ? {} : { data }) });
    await options.onUpdate?.(structuredClone(job));
  };
  const status = async (next: JobStatus, message: string) => { job.status = next; await emit("orchestrator", "status", message); };
  const baseGenerate = options.generate || createGenerator({ mode: job.mode, signal: options.signal });
  const generate: Generator = async (agent, instruction, input, schema, reference) => {
    options.signal?.throwIfAborted();
    if (job.mode === "ai" && ++job.modelCalls > 8) throw new Error("Modellbudget erreicht.");
    const output = schema.parse(await baseGenerate(agent, instruction, input, schema, reference));
    await emit(agent, "response", `${agent}: strukturierte Antwort erhalten`, output);
    return output;
  };
  try {
    await status("checking", "Opportunity, Linkziel und Briefing prüfen");
    const source = new URL(opportunity.product.sourceUrl);
    const affiliate = new URL(opportunity.product.affiliateUrl);
    if ([source, affiliate].some(url => url.protocol !== "https:" || url.username || url.password)) throw new Error("Bitte einen öffentlichen HTTPS-Produktlink ohne Zugangsdaten verwenden.");
    await emit("orchestrator", "decision", source.pathname === "/s" ? "Suchauswahl erkannt: keine geprüften Eigenschaften eines einzelnen Modells behaupten." : "Produktlink ist keine Faktenprüfung; Modellangaben benötigen Nachweise.", { verifiedFactCount: opportunity.verifiedFacts.length, mode: job.mode });
    await status("ideating", "Creative Agent entwickelt drei Formatideen");
    job.ideas = (await creativeAgent(opportunity, generate)).ideas;
    await status("selecting", "Orchestrator bewertet Ideen und wählt das Format");
    const learning = options.loadLearning ? await options.loadLearning(opportunity) : undefined;
    if (learning) await emit("orchestrator", "decision", learning.summary, learning);
    job.decision = selectIdea(job.ideas, opportunity, learning);
    await emit("orchestrator", "decision", job.decision.reason, job.decision);
    const idea = job.ideas.find(i => i.id === job.decision!.ideaId)!;
    // Explicit bounded loop: first draft plus at most two revisions. No recursion or agent routing from model output.
    for (let attempt = 0; attempt <= MAX_REVISIONS; attempt++) {
      options.signal?.throwIfAborted();
      job.revisions = attempt;
      await status(attempt ? "revising" : "producing", attempt ? `Überarbeitung ${attempt} von ${MAX_REVISIONS}` : `${job.decision.format}-Agent beauftragt`);
      job.content = contentSchema.parse(await producers[job.decision.format]({ opportunity, idea, feedback: job.review, previous: job.content }, generate));
      await status("reviewing", "Orchestrator prüft Anwendung, Glaubwürdigkeit und Umsetzbarkeit");
      const structural = inspectContent(job.content, job.decision);
      const semantic = job.mode === "ai" ? await generate("orchestrator", `Prüfe redaktionell streng: konkrete Alltagssituation, überzeugender Nutzen, Hook, glaubwürdige Aussagen, Modellnachweise, korrektes Zubehör, verständliche Geschichte, sprechbare Länge, Linkziel und CTA. Unbelegte konkrete Modellbehauptungen oder erfundene Erfahrungen führen zu passed=false. Keine Pflicht zu künstlichen Zusatznutzen. Gib konkrete Reparaturanweisungen; ab score 75 und ohne wesentliche Mängel bestanden.`, { opportunity, idea, content: job.content }, reviewSchema, () => structural) : structural;
      job.review = { passed: structural.passed && semantic.passed && semantic.score >= 75 && semantic.issues.length === 0,
        score: Math.min(structural.score, semantic.score), issues: [...structural.issues, ...semantic.issues].filter((v, i, a) => a.indexOf(v) === i) };
      await emit("orchestrator", "decision", job.review.passed ? "Entwurf für Marketingplanung geeignet; menschliche Freigabe bleibt offen." : "Entwurf benötigt Überarbeitung.", job.review);
      if (job.review.passed) break;
    }
    if (!job.review?.passed) { await status("needs_input", "Revisionslimit erreicht. Briefing oder Fakten ergänzen; kein Marketingauftrag."); return job; }
    await status("marketing", "Geprüften Entwurf an Marketing übergeben");
    job.marketing = await marketingAgent({ opportunity, content: job.content! }, generate);
    const platform = job.marketing.primary;
    const compatible = job.content!.format === "video" ? ["Instagram Reel", "Facebook Video"].includes(platform)
      : job.content!.format === "image" ? [job.content!.format === "image" && job.content!.layout === "carousel" ? "Instagram Carousel" : "Instagram Bild", "Facebook Post", "Gruppenbeitrag"].includes(platform)
      : ["Facebook Post", "Gruppenbeitrag"].includes(platform);
    const targetMatches = opportunity.targetPlatform === "any" || (opportunity.targetPlatform === "instagram" ? platform.startsWith("Instagram") : !platform.startsWith("Instagram"));
    if (!compatible || !targetMatches) { await status("needs_input", "Marketingformat passt nicht zum erstellten Inhalt. Manuell klären."); return job; }
    await emit("orchestrator", "decision", `Marketingempfehlung akzeptiert: ${platform}. Veröffentlichung erfordert gesonderte Freigabe.`);
    await status("awaiting_approval", "Content-Plan fertig. Bitte redaktionell prüfen und freigeben.");
  } catch (error) {
    const aborted = options.signal?.aborted;
    job.error = aborted ? "Planung unterbrochen. Kein automatischer Neustart." : error instanceof Error ? error.message : "Planung fehlgeschlagen.";
    job.status = aborted ? "interrupted" : "failed";
    await emit("orchestrator", "error", job.error);
  }
  return job;
}
