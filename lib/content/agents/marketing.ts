import { marketingSchema, type Content, type Opportunity } from "../schema";
import type { Generator } from "../agent";

export function marketingAgent(input: { opportunity: Opportunity; content: Content }, generate: Generator) {
  return generate("marketing", "Empfiehl eine passende Plattform samt Format für das geprüfte Content-Stück. Berücksichtige Zielgruppe, Ziel, Budget, Trend und Glaubwürdigkeit. Eine konkrete targetPlatform ist verbindlich. Begründe Conversion als Hypothese, nicht als garantierte Kennzahl. Liefere Anpassungen, Linkplatzierung, Messgrößen und Freigabechecks. Gruppenbeiträge nur mit passenden Gruppenregeln. Niemals posten.", input, marketingSchema, () => {
    const { opportunity, content } = input;
    const primary = opportunity.targetPlatform === "facebook" ? (content.format === "video" ? "Facebook Video" as const : opportunity.goal === "community" ? "Gruppenbeitrag" as const : "Facebook Post" as const) : content.format === "video" ? "Instagram Reel" as const : content.format === "image" ? (content.layout === "carousel" ? "Instagram Carousel" as const : "Instagram Bild" as const) : opportunity.goal === "community" ? "Gruppenbeitrag" as const : "Facebook Post" as const;
    return { primary, audience: opportunity.product.targetGroup,
      rationale: `${content.format === "video" ? "Die sichtbare Anwendung und das emotionale Ergebnis tragen die Geschichte." : content.format === "image" ? "Die Schrittfolge lässt sich speichern und in Ruhe ansehen." : "Die Erklärung erlaubt Nuancen und eine Diskussion über Voraussetzungen."} Ziel: ${opportunity.goal === "conversion" ? "informierte Kaufentscheidung" : opportunity.goal === "education" ? "Verständnis" : "Austausch"}.`,
      adaptation: content.format === "video"
        ? /(?:kürbis|kuerbis|pumpkin).{0,40}(?:schnitz|carving)|(?:schnitz|carving).{0,40}(?:kürbis|kuerbis|pumpkin)/i.test(opportunity.product.name)
          ? "Hochformat, sichtbares Schnitzen eines echten Halloween-Kürbisses mit dem Kürbisschnitzwerkzeug in Nahaufnahme, Untertitel und Werbekennzeichnung. Vom Werkzeug über die Schnitzhandlung zur leuchtenden Deko-Laterne erzählen."
          : "Hochformat, sprechbarer Dialog, Untertitel, produktbezogene Nahaufnahme und sichtbare Werbung. Einzelne Szenen schneiden und vertonen."
        : content.format === "image" ? "Einheitliches Layout, große lesbare Überschriften und Werbekennzeichnung auf dem ersten Slide." : "Kurze Absätze, fachliche Grenzen und eine offene Leserfrage beibehalten.",
      linkPlacement: primary.startsWith("Instagram") ? "Genau einen gekennzeichneten Produktlink und die ASIN als Caption-Text angeben. Dieser organische API-Weg erzeugt keinen externen Shopping-Button; der Caption-Link ist kein zugesicherter klickbarer Link." : "Gekennzeichneten Affiliate-Link ergänzen, sofern die Regeln des Veröffentlichungsorts dies erlauben.",
      conversionHypothesis: "Ein nachvollziehbarer Anwendungsfall könnte qualifizierte Klicks fördern. Ohne Messdaten ist das eine Hypothese.",
      metrics: ["Qualifizierte Linkklicks", "Verkäufe und Provision", content.format === "video" ? "Wiedergabedauer" : "Gespeicherte Beiträge und Rückfragen"],
      publishingChecks: ["Inhalt, Werbekennzeichnung und Linkziel menschlich freigeben.", "Plattform-/Gruppenregeln und benötigte Medienrechte prüfen.", "Keine Veröffentlichung durch diesen Planungsauftrag."],
    };
  });
}
