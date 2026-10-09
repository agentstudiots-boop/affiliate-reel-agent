import { CAROUSEL_MAX_SLIDES, CAROUSEL_MIN_SLIDES } from "../../formats/catalog";
import { emitEvent } from "../../observability/events";
import { imagePromptFromBrief, type StyleBrief } from "../style";

// CarouselPlanner: first a structured plan, then rendering. The slide count follows the content (number of
// points the copy actually has), within 3–7, unless the operator asked for a specific number. Per slide it decides
// whether a generated image is worth it; most slides are text graphics. Max generated images per carousel is capped.

export type CarouselSource = {
  contentId: string; title: string; hook: string; problem: string; coreMessage: string;
  points: { headline: string; text: string }[];
  cta: string; visualPotential: number; imageProviderAvailable: boolean;
};
export const SLIDE_PURPOSES = ["hook", "problem", "point", "solution", "summary", "question", "cta"] as const;
export const VISUAL_TYPES = ["generated_image", "text_graphic", "simple_graphic", "existing_asset", "icon", "layout", "image_text"] as const;
export type Slide = {
  slide_number: number;
  purpose: (typeof SLIDE_PURPOSES)[number];
  headline: string;
  supporting_text: string;
  visual_type: (typeof VISUAL_TYPES)[number];
  visual_brief: string;
  requires_generated_image: boolean;
  cta: string | null;
};
export type CarouselPlan = { contentId: string; slide_count: number; style: StyleBrief; slides: Slide[]; generated_images: number; count_reason: string };

export const MAX_GENERATED_PER_CAROUSEL = 3;

export function planCarousel(source: CarouselSource, style: StyleBrief, requestedSlides?: number | null): CarouselPlan {
  const points = source.points.filter(point => point.headline.trim()).slice(0, CAROUSEL_MAX_SLIDES - 2);
  // Natural length: hook + problem + points + CTA; fewer points → compact.
  const natural = Math.max(CAROUSEL_MIN_SLIDES, Math.min(CAROUSEL_MAX_SLIDES, points.length + 3));
  const target = requestedSlides ? Math.max(CAROUSEL_MIN_SLIDES, Math.min(CAROUSEL_MAX_SLIDES, requestedSlides)) : natural;
  const countReason = requestedSlides ? `Betreiberwunsch: ${target} Slides` : `${points.length} inhaltliche Punkte → ${target} Slides`;

  // Fit points into the middle: target − hook − CTA (− problem when there is room).
  const middle = target - 2;
  const withProblem = middle >= 2 && points.length < middle;
  const pointSlots = middle - (withProblem ? 1 : 0);
  let used = points.slice(0, pointSlots);
  if (points.length > pointSlots && pointSlots > 0) {
    // Too many points for the requested length: merge the rest into the last slot instead of dropping them silently.
    const rest = points.slice(pointSlots - 1);
    used = [...points.slice(0, pointSlots - 1), { headline: rest[0].headline, text: rest.map(point => point.headline).join(" · ") }];
  }
  const slides: Omit<Slide, "slide_number">[] = [];
  const motif = (text: string) => imagePromptFromBrief(style, text);
  slides.push({ purpose: "hook", headline: source.hook, supporting_text: source.title, visual_type: "image_text", visual_brief: motif(`Alltagsszene zum Thema „${source.title}“`), requires_generated_image: true, cta: null });
  if (withProblem) slides.push({ purpose: "problem", headline: "Das Problem", supporting_text: source.problem, visual_type: "image_text", visual_brief: motif(`Typische Alltagssituation: ${source.problem}`), requires_generated_image: true, cta: null });
  used.forEach((point, index) => {
    const solution = index === used.length - 1 && used.length > 1;
    slides.push({ purpose: solution ? "solution" : "point", headline: point.headline, supporting_text: point.text,
      visual_type: solution ? "image_text" : "text_graphic", visual_brief: solution ? motif(`Ergebnis im Alltag: ${point.headline}`) : `Textgrafik im Stil-Layout: ${point.headline}`,
      requires_generated_image: solution, cta: null });
  });
  while (slides.length < target - 1) {
    slides.push(slides.some(slide => slide.purpose === "summary")
      ? { purpose: "question", headline: "Wie machst du das?", supporting_text: "Schreib deinen besten Alltagstipp in die Kommentare.", visual_type: "layout", visual_brief: "Frage-Layout", requires_generated_image: false, cta: null }
      : { purpose: "summary", headline: "Kurz zusammengefasst", supporting_text: source.coreMessage, visual_type: "icon", visual_brief: "Checkliste mit Icons", requires_generated_image: false, cta: null });
  }
  slides.push({ purpose: "cta", headline: source.cta, supporting_text: "Speichern und später nachlesen.", visual_type: "layout", visual_brief: "CTA-Layout mit Akzentfläche", requires_generated_image: false, cta: source.cta });

  // Generated pictures only where they add value and a provider exists; capped.
  let budget = source.imageProviderAvailable ? MAX_GENERATED_PER_CAROUSEL : 0;
  const planned = slides.map((slide, index) => {
    const threshold = slide.purpose === "hook" ? 40 : slide.purpose === "problem" ? 60 : 75;
    const requires = slide.requires_generated_image && budget > 0 && source.visualPotential >= threshold;
    if (requires) budget--;
    return { ...slide, slide_number: index + 1, requires_generated_image: requires, visual_type: requires ? slide.visual_type : slide.visual_type === "image_text" ? "text_graphic" as const : slide.visual_type };
  });
  const plan: CarouselPlan = { contentId: source.contentId, slide_count: planned.length, style, slides: planned, generated_images: planned.filter(slide => slide.requires_generated_image).length, count_reason: countReason };
  emitEvent("carousel_plan_created", { contentId: source.contentId, slides: plan.slide_count, generatedImages: plan.generated_images, reason: countReason });
  return plan;
}
