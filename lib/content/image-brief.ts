import type { ContentJob } from "./schema";
import { analyzeProductInspiration } from "./product-inspiration";

function excerpt(value: string, limit: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit).replace(/\s+\S*$/, "").trim()}…`;
}

// Assemble the same concrete, human-readable brief for approval and rendering.
// All scene data comes from the saved job, so an operator revision replaces it.
export function imageBrief(job: ContentJob): string {
  if (job.content?.format !== "image" || !job.content.slides[0] || !job.content.visualConcept) {
    throw new Error("Bildbriefing fehlt.");
  }
  const { content, opportunity } = job;
  const scene = content.slides[0];
  const concept = content.visualConcept!;
  const category = analyzeProductInspiration(opportunity).categoryLabel;
  const pumpkinCarving = /kürbis.*schnitz|schnitz.*kürbis/i.test(opportunity.product.name);
  return [
    pumpkinCarving ? "HAUPTMOTIV – zwingend sofort erkennbar: Ein großer, eindeutig als echter orangefarbener Halloween-Kürbis erkennbarer Kürbis nimmt den Bildvordergrund ein. Eine erwachsene Person schnitzt gerade mit einem kleinen Kürbisschnitzwerkzeug die Augen- oder Mundöffnung in seine Schale; die ausgeschnittenen Gesichtszüge und der aktive Schnitzvorgang sind deutlich sichtbar. Kürbis und Schnitzhandlung müssen stärker auffallen als Person, Werkzeuge und Hintergrund." : `HAUPTMOTIV – zwingend sofort erkennbar: Die konkrete Anwendung der Produktkategorie ${category} steht groß und deutlich im Vordergrund; Person und Dekoration unterstützen nur die Handlung.`,
    `Motiv und Handlung: ${excerpt(scene.visual, 360)}`,
    `Alltag und Umgebung: ${excerpt(concept.everydaySituation, 220)}`,
    `Sichtbarer Produktbezug: Eine neutrale, unmarkierte Darstellung der Kategorie ${category} muss bei der beschriebenen Anwendung erkennbar sein. Handlung und Produktbezug sind das Hauptmotiv, nicht bloß Dekoration.`,
    `Bildaufbau und Details: ${excerpt(scene.prompt, 550)}`,
    pumpkinCarving ? "Nebenmotive: Mehrere kleine unmarkierte Kürbisschnitzwerkzeuge neben dem Kürbis, echte Kürbiskerne und Schalenreste auf dem Basteltisch, fertige geschnitzte Laternen im unscharfen Hintergrund. Keine Kinder, keine Backwaren oder Teigfiguren, keine Speisen, keine Küche, keine Funken und kein großes Küchenmesser. Keine exakte Abbildung oder Ausstattung des beworbenen Modells behaupten." : "",
    "Grenzen: Keine Modellmerkmale, Zubehörteile oder Anwendungsschritte erfinden; ohne verifizierte Fakten nur die Produktkategorie zeigen. Keine Logos, Händlerbilder, Schrift im Bild oder irreführende Produktdarstellung.",
  ].filter(Boolean).join("\n");
}
