import type { Content, Marketing, Opportunity } from "./schema";

export function isPumpkinCarvingProduct(name: string) {
  return /(?:kürbis|kuerbis|pumpkin).{0,40}(?:schnitz|carving)|(?:schnitz|carving).{0,40}(?:kürbis|kuerbis|pumpkin)/i.test(name);
}

export function classifyOpportunity(opportunity: Opportunity): Opportunity {
  return isPumpkinCarvingProduct(opportunity.product.name)
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
  if (opportunity.category !== "home_living") issues.push("Kürbisschnitzen als Home & Living/Dekoration einordnen.");
  if (/\b(?:appetitlich\w*|koch(?:en|t|st|end)?|garen|ess(?:en|bar)|speise|rezept|mahlzeit|kulinarisch\w*)\b/i.test(publicCopy)) {
    issues.push("Kürbisschnitzen darf nicht als Kochen oder Essen dargestellt werden.");
  }
  if (content.format !== "text" && !/kürbis|kuerbis|pumpkin/i.test(story)) issues.push("Echter Kürbis muss das Hauptmotiv sein.");
  if (content.format !== "text" && !/schnitz|carv/i.test(story)) issues.push("Der Schnitzvorgang muss sichtbar beschrieben werden.");
  return issues;
}
