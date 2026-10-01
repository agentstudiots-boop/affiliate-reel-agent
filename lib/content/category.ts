import type { Content, Marketing, Opportunity } from "./schema";

export function isPumpkinCarvingProduct(name: string) {
  return /(?:kürbis|kuerbis|pumpkin).{0,40}(?:schnitz|carving)|(?:schnitz|carving).{0,40}(?:kürbis|kuerbis|pumpkin)/i.test(name);
}

export function classifyOpportunity(opportunity: Opportunity): Opportunity {
  // Legacy safety net at job creation: pumpkin carving is never filed under a category that implies cooking or housekeeping.
  // Seasonal, decor and home categories (also chosen by the operator) are kept.
  return !["home_living", "decor", "seasonal"].includes(opportunity.category) && isPumpkinCarvingProduct(opportunity.product.name)
    ? { ...opportunity, category: "home_living" }
    : opportunity;
}

export function pumpkinCreativeIssues(opportunity: Opportunity, content: Content, marketing?: Marketing): string[] {
  if (!isPumpkinCarvingProduct(opportunity.product.name)) return [];
  const story = content.format === "video"
    ? content.scenes.map(scene => `${scene.visual} ${scene.audio}`).join(" ")
    : content.format === "image" ? content.slides.map(slide => `${slide.visual} ${slide.prompt}`).join(" ") : content.body;
  const publicCopy = `${content.hook} ${content.format === "text" ? content.body : content.caption} ${content.cta} ${marketing?.adaptation ?? ""}`;
  const issues: string[] = [];
  if (/\b(?:appetitlich\w*|koch(?:e|en|t|st|end)?|garen|ess(?:en|bar)|iss|speise|rezept|mahlzeit|kulinarisch\w*|pasta|nudeln?|pfanne)\b/i.test(publicCopy)) {
    issues.push("Kürbisschnitzen darf nicht als Kochen oder Essen dargestellt werden.");
  }
  if (/deinem anwendungsfall|beim einrichten|raum und (?:deinen )?alltag|material, maße und pflege/i.test(publicCopy)) {
    issues.push("Der Begleittext muss die Halloween-Kürbislaterne und das Schnitzen beschreiben statt allgemeine Wohnraumtipps.");
  }
  if (content.format !== "text" && !/kürbis|kuerbis|pumpkin/i.test(story)) issues.push("Echter Kürbis muss das Hauptmotiv sein.");
  if (content.format !== "text" && !/schnitz|carv/i.test(story)) issues.push("Der Schnitzvorgang muss sichtbar beschrieben werden.");
  return issues;
}
