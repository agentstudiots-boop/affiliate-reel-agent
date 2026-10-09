import type { QualityResult } from "./gate";
import type { ImageSpec } from "./spec";

// Structured feedback from the quality manager (visual gate) to the creative briefing: not just "rejected", but what is
// wrong, which requirement it violates, where the error most likely lies, how certain that is, what to correct and what
// must stay. Causes are a judgement; uncertain ones are marked uncertain and never become long-term rules on their own.

export type IssueCode = "primary_missing" | "primary_not_dominant" | "forbidden_object" | "wrong_product" | "defects" | "text_logos" | "unrealistic_use"
  | "concept_unclear" | "technical" | "check_uncertain";
export type Cause = "briefing" | "prompt_transformation" | "generation" | "product_reference" | "technical" | "provider" | "unknown";
export type FeedbackItem = {
  code: IssueCode;
  object?: string;              // e.g. the excluded object that appeared
  issue: string;
  violated_requirement: string;
  cause: Cause;
  certainty: "likely" | "uncertain";
  correction: string;
  keep: string[];
};

// A briefing that names only a category word, without product type or concrete motif, is too general to steer the image.
export const vagueBriefing = (spec: ImageSpec) => !spec.product_type || spec.primary_object_terms.length < 2 && spec.primary_object.split(/\s+/).length <= 2;

export function feedbackFor(quality: QualityResult, context: { spec: ImageSpec; attemptNo: number; promptCorrected: boolean; previous: IssueCode[] }): FeedbackItem[] {
  const { spec } = context;
  const keep = [`Hauptmotiv: ${spec.primary_object}`, `Komposition: ${spec.composition}`, ...spec.forbidden_objects.map(item => `ausgeschlossen: ${item}`)].slice(0, 6);
  const repeated = (code: IssueCode) => context.previous.includes(code);
  const items: FeedbackItem[] = [];
  const f = quality.findings;
  if (f.technical) items.push({ code: "technical", issue: quality.hard_failures.join(" "), violated_requirement: "Bild abrufbar, vollständig, 4:5", cause: "technical", certainty: "likely",
    correction: "Speicherung bzw. Abruf prüfen; kein neues Bild erzeugen.", keep });
  if (f.primaryMissing) items.push({ code: "primary_missing", issue: `Hauptmotiv „${spec.primary_object}“ nicht erkennbar.`, violated_requirement: "primary_object_required",
    cause: vagueBriefing(spec) ? "briefing" : repeated("primary_missing") ? "briefing" : "generation", certainty: vagueBriefing(spec) || repeated("primary_missing") ? "likely" : "uncertain",
    correction: vagueBriefing(spec) ? `Hauptmotiv konkret als ${spec.product_type || "Produkt"} mit Motiv und Form festlegen und als dominantes Objekt im Vordergrund beschreiben.`
      : `${spec.primary_object} ausdrücklich als größtes, schärfstes Objekt im Vordergrund (Nahaufnahme) festlegen.`, keep });
  if (f.composition) items.push({ code: "primary_not_dominant", issue: "Hauptmotiv sichtbar, aber nicht dominant.", violated_requirement: "primary_object_prominence=dominant",
    cause: repeated("primary_not_dominant") ? "briefing" : "generation", certainty: repeated("primary_not_dominant") ? "likely" : "uncertain",
    correction: `Nahaufnahme: ${spec.primary_object} füllt den Großteil des Bildes, Umgebung nur angedeutet.`, keep });
  for (const object of f.forbiddenSeen) items.push({ code: "forbidden_object", object: object.toLocaleLowerCase("de-DE").slice(0, 60), issue: `Unerwünschtes Motiv sichtbar: ${object}.`,
    violated_requirement: spec.forbidden_objects.length ? "forbidden_objects" : "Hauptmotiv dominiert",
    // The provider prompt never names excluded objects (validated); if the briefing text had named it, the transformation removed it.
    cause: context.promptCorrected ? "prompt_transformation" : "generation", certainty: context.promptCorrected || repeated("forbidden_object") ? "likely" : "uncertain",
    correction: `${object} ausschließen; Szene nur mit dem Hauptmotiv und neutraler Umgebung.`, keep });
  if (f.wrongProduct) items.push({ code: "wrong_product", issue: quality.hard_failures.find(item => /Falsches Produkt/.test(item)) ?? "Falsches Produkt.", violated_requirement: "Produktart",
    cause: spec.product_type ? "generation" : "briefing", certainty: spec.product_type && !repeated("wrong_product") ? "uncertain" : "likely",
    correction: `Produktart eindeutig zeigen: ${spec.product_type || spec.primary_object}.`, keep });
  if (f.defects) items.push({ code: "defects", issue: [...quality.hard_failures, ...quality.soft_failures].find(item => /Bildfehler|Unrealistisch/.test(item)) ?? "Bildfehler.",
    violated_requirement: "visuelle Qualität / Produktrealismus", cause: "generation", certainty: "uncertain",
    correction: "Einfache, realistische Formen; keine komplexe Hand-Produkt-Interaktion.", keep });
  if (quality.hard_failures.some(item => /Schrift, Logo/.test(item))) items.push({ code: "text_logos", issue: "Schrift oder Logo im Bild.", violated_requirement: "keine Schrift/Logos",
    cause: "generation", certainty: "uncertain", correction: "Sauberes Bild ohne Beschriftung.", keep });
  if (quality.uncertain) items.push({ code: "check_uncertain", issue: quality.soft_failures.join(" ") || "Prüfung unsicher.", violated_requirement: "eindeutige Prüfung",
    cause: "unknown", certainty: "uncertain", correction: "Keine automatische Korrektur; menschliche Prüfung.", keep });
  return items;
}

// The creative briefing applies the feedback: only the violated aspects change, everything else stays.
export function reviseSpecFromFeedback(spec: ImageSpec, feedback: FeedbackItem[]): ImageSpec {
  let next = { ...spec };
  for (const item of feedback) {
    if (item.code === "primary_missing" || item.code === "primary_not_dominant") {
      next = { ...next, primary_object_prominence: "dominant",
        composition: `Nahaufnahme: ${spec.primary_object} ist das größte, schärfste Objekt im Vordergrund und füllt den Großteil des Bildes. ${spec.composition}`.slice(0, 240) };
    }
    if (item.code === "forbidden_object" && item.object) next = { ...next, forbidden_objects: [...new Set([...next.forbidden_objects, item.object])].slice(0, 12) };
    if (item.code === "wrong_product" && spec.product_type && !next.composition.includes("eindeutig als")) {
      next = { ...next, composition: `${next.composition} Eindeutig als ${spec.product_type} erkennbar.`.slice(0, 240) };
    }
  }
  return next;
}
