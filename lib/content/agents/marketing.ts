import { marketingSchema, type Content, type Opportunity } from "../schema";
import type { Generator } from "../agent";

export function marketingAgent(input: { opportunity: Opportunity; content: Content }, generate: Generator) {
  return generate("marketing", "Empfiehl eine passende Plattform samt Format für das geprüfte Content-Stück. Berücksichtige Zielgruppe, Ziel, Budget, Trend und Glaubwürdigkeit. Eine konkrete targetPlatform ist verbindlich. Begründe Conversion als Hypothese, nicht als garantierte Kennzahl. Liefere Anpassungen, Linkplatzierung, Messgrößen und Freigabechecks. Gruppenbeiträge nur mit passenden Gruppenregeln. Niemals posten.", input, marketingSchema, () => {
    const { opportunity, content } = input;
    const primary = opportunity.targetPlatform === "facebook" ? (content.format === "video" ? "Facebook Video" as const : opportunity.goal === "community" ? "Gruppenbeitrag" as const : "Facebook Post" as const) : content.format === "video" ? "Instagram Reel" as const : content.format === "image" ? (content.layout === "carousel" ? "Instagram Carousel" as const : "Instagram Bild" as const) : opportunity.goal === "community" ? "Gruppenbeitrag" as const : "Facebook Post" as const;
    return { primary, audience: opportunity.product.targetGroup,
      rationale: `${content.format === "video" ? "Die sichtbare Anwendung und das emotionale Ergebnis tragen die Geschichte." : content.format === "image" ? "Die Schrittfolge lässt sich speichern und in Ruhe ansehen." : "Die Erklärung erlaubt Nuancen und eine Diskussion über Voraussetzungen."} Ziel: ${opportunity.goal === "conversion" ? "informierte Kaufentscheidung" : opportunity.goal === "education" ? "Verständnis" : "Austausch"}.`,
      adaptation: content.format === "video" ? "Hochformat, sprechbarer Dialog, Untertitel, appetitliche Nahaufnahme und sichtbare Werbung. Einzelne Szenen schneiden und vertonen." : content.format === "image" ? "Einheitliches Layout, große lesbare Überschriften und Werbekennzeichnung auf dem ersten Slide." : "Kurze Absätze, fachliche Grenzen und eine offene Leserfrage beibehalten.",
      linkPlacement: primary.startsWith("Instagram") ? "Gekennzeichneten Affiliate-Link über einen tatsächlich eingerichteten Profil-Link erreichbar machen; CTA vor Veröffentlichung abgleichen." : "Gekennzeichneten Affiliate-Link ergänzen, sofern die Regeln des Veröffentlichungsorts dies erlauben.",
      conversionHypothesis: "Ein nachvollziehbarer Anwendungsfall könnte qualifizierte Klicks fördern. Ohne Messdaten ist das eine Hypothese.",
      metrics: ["Qualifizierte Linkklicks", "Verkäufe und Provision", content.format === "video" ? "Wiedergabedauer" : "Gespeicherte Beiträge und Rückfragen"],
      publishingChecks: ["Inhalt, Werbekennzeichnung und Linkziel menschlich freigeben.", "Plattform-/Gruppenregeln und benötigte Medienrechte prüfen.", "Keine Veröffentlichung durch diesen Planungsauftrag."],
    };
  });
}
