import type { ContentJob } from "../schema";
import { mentions, type ImageSpec } from "./spec";

// Provider prompt for text-to-image models without negative prompts (FLUX on Replicate).
//
// Two properties matter for these models: (1) everything named in the prompt tends to appear in the picture, including
// things that are only mentioned to be excluded ("kein Hund" adds a dog); (2) the text encoder reads a limited number of
// tokens, so the subject must come first and the prompt must stay short. The long German approval brief therefore stays
// the human-readable record; the provider gets this compact, positive prompt, validated before any paid call.

export const MAX_PROVIDER_PROMPT = 1400;
// Clauses (sentences and comma-separated parts), so that only the negated or excluded part of a sentence is dropped.
const sentences = (text: string) => text.replace(/\s+/g, " ").split(/(?<=[.!?;,])\s+/).map(item => item.trim()).filter(Boolean);
// Drops every sentence that names an excluded object (a negation is still a mention) or an exclusion phrase.
function positive(text: string, forbidden: string[]) {
  return sentences(text).filter(sentence => !(forbidden.length && mentions(sentence, forbidden)) && !/\b(?:kein|keine|keinen|ohne|nicht|verboten|niemals)\b/i.test(sentence)).join(" ");
}
const clip = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, "")}`;

export type PromptCorrection = { primaryMissing?: boolean; forbiddenSeen?: string[]; wrongProduct?: boolean; defects?: boolean; composition?: boolean };

export function buildProviderPrompt(spec: ImageSpec, job: ContentJob | null, correction: PromptCorrection = {}): string {
  const content = job?.content?.format === "image" ? job.content : null;
  const scene = content ? positive([content.slides[0]?.visual ?? "", content.visualConcept?.everydaySituation ?? ""].join(" "), spec.forbidden_objects) : "";
  const changes = spec.change_instructions.map(change => positive(change, spec.forbidden_objects)).filter(Boolean);
  const emphasis = [
    correction.primaryMissing || correction.composition ? `The ${spec.primary_object} is the largest, sharpest object, close to the camera, filling most of the frame.` : "",
    correction.wrongProduct ? `Show exactly ${spec.primary_object}; the product category must be unmistakable.` : "",
    correction.defects ? "Clean realistic shapes, correct proportions, sharp focus, natural textures." : "",
    correction.forbiddenSeen?.length ? "The scene shows only objects and decor in an empty setting, with no animals and no people." : "",
  ].filter(Boolean);
  const parts = [
    `Photorealistic editorial lifestyle photo, vertical 4:5. MAIN SUBJECT (${spec.primary_object_prominence === "dominant" ? "dominant, in the foreground, clearly recognisable" : "clearly visible"}): ${spec.primary_object}.`,
    `Composition: ${spec.composition}.`,
    ...emphasis,
    spec.setting && spec.content_type === "affiliate_image" ? `Setting: ${clip(positive(spec.setting, spec.forbidden_objects), 160)}` : "",
    ...spec.learned_guidance.map(item => positive(item, spec.forbidden_objects)).filter(Boolean),
    scene ? `Scene: ${clip(scene, 380)}` : "",
    changes.length ? `Requested changes (keep the main subject): ${clip(changes.join(" "), 240)}` : "",
    `Style: ${spec.style}. Purpose: ${spec.commercial_intent}.`,
    spec.identity_class === "symbolic" ? "" : spec.identity_class === "brand_article"
      ? `A generic, unbranded ${spec.product_type || "product"} in the typical form of this product type; clean image without lettering or logos.`
      : "Generic unbranded product, clean image without lettering or logos.",
  ].filter(Boolean);
  return clip(parts.join("\n"), MAX_PROVIDER_PROMPT);
}

export type PromptCheck = { ok: boolean; errors: string[] };

// Final check of exactly the text that would be sent to the provider.
export function validateProviderPrompt(spec: ImageSpec, prompt: string, options: { aspectRatio: string; referenceImages?: string[] } = { aspectRatio: "4:5" }): PromptCheck {
  const errors: string[] = [];
  if (!mentions(prompt.slice(0, 400), spec.primary_object_terms)) errors.push(`Pflichtmotiv „${spec.primary_object}“ fehlt am Anfang des Provider-Prompts.`);
  for (const required of spec.required_objects) if (!mentions(prompt, [required])) errors.push(`Pflichtobjekt „${required}“ fehlt im Provider-Prompt.`);
  const named = spec.forbidden_objects.filter(word => mentions(prompt, [word]));
  if (named.length) errors.push(`Ausgeschlossene Motive im Provider-Prompt: ${named.join(", ")}.`);
  if (new RegExp(`(?:${spec.primary_object_terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[^.\\n]{0,40}(?:im hintergrund|unscharf|nebensächlich|nur am rand|in the background|blurred)`, "i").test(prompt))
    errors.push("Widerspruch: Hauptmotiv wird in den Hintergrund gestellt.");
  if (options.aspectRatio !== spec.aspect_ratio) errors.push(`Bildformat ${options.aspectRatio} statt ${spec.aspect_ratio}.`);
  if (prompt.length > MAX_PROVIDER_PROMPT) errors.push("Provider-Prompt zu lang; das Modell würde das Ende abschneiden.");
  if (options.referenceImages?.length) errors.push("Referenzbilder sind für diesen Bildauftrag nicht vorgesehen.");
  return { ok: errors.length === 0, errors };
}

// Deterministic repair before a paid call: missing subject → subject line first; excluded objects → sentences removed.
// Anything still wrong stops the job (no provider call).
export function validatedPrompt(spec: ImageSpec, prompt: string, aspectRatio = "4:5"): { ok: true; prompt: string; corrected: boolean } | { ok: false; errors: string[] } {
  const first = validateProviderPrompt(spec, prompt, { aspectRatio });
  if (first.ok) return { ok: true, prompt, corrected: false };
  let repaired = positive(prompt.replace(/\n/g, " \n"), spec.forbidden_objects);
  if (!mentions(repaired.slice(0, 400), spec.primary_object_terms)) repaired = `MAIN SUBJECT (dominant, in the foreground): ${spec.primary_object}.\n${repaired}`;
  repaired = clip(repaired, MAX_PROVIDER_PROMPT);
  const second = validateProviderPrompt(spec, repaired, { aspectRatio });
  return second.ok ? { ok: true, prompt: repaired, corrected: true } : { ok: false, errors: second.errors };
}
