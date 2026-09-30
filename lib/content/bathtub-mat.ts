import type { Content, Opportunity } from "./schema";

// A bath mat placed inside a tub is a different use case from a floor mat.
// The verified product title is identity evidence, not proof of any safety claim.
export function isBathtubMat(name: string) {
  return /badewannenmatte|badewannen.?einlage/i.test(name);
}

export const bathtubMatUseCase = "Eine Badewannenmatte in die Badewanne legen und anhand der Herstellerhinweise prüfen, ob Maße, Untergrund und Pflege zur eigenen Wanne passen.";

export function bathtubMatIssues(opportunity: Opportunity, content: Content): string[] {
  if (!isBathtubMat(opportunity.product.name)) return [];
  const visual = content.format === "image"
    ? [content.useCase, content.visualConcept?.mainIdea, content.visualConcept?.everydaySituation,
      ...content.slides.flatMap(slide => [slide.visual, slide.prompt, slide.alt])].join(" ")
    : content.format === "video" ? content.scenes.map(scene => scene.visual).join(" ") : content.useCase;
  const copy = [content.hook, content.format === "text" ? content.body : content.caption, content.cta].join(" ");
  const issues: string[] = [];
  if (!/badewann/i.test(visual) || /vor (?:der|dem) dusche|vor (?:der|dem) badewanne|badezimmerboden|duschvorleger/i.test(visual))
    issues.push("Badewannenmatte innerhalb der Badewanne zeigen; nicht als Bodenmatte vor der Dusche darstellen.");
  if (/vor (?:der|dem) dusche|vor (?:der|dem) badewanne|duschvorleger/i.test(copy))
    issues.push("Beitragstext nennt fälschlich eine Bodenmatte vor der Dusche statt die Anwendung in der Badewanne.");
  return issues;
}
