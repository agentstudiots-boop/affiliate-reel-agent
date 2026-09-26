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
    `Motiv und Handlung: ${excerpt(scene.visual, 360)}`,
    `Alltag und Umgebung: ${excerpt(concept.everydaySituation, 220)}`,
    `Sichtbarer Produktbezug: Eine neutrale, unmarkierte Darstellung der Kategorie ${category} muss bei der beschriebenen Anwendung erkennbar sein. Handlung und Produktbezug sind das Hauptmotiv, nicht bloß Dekoration.`,
    `Bildaufbau und Details: ${excerpt(scene.prompt, 550)}`,
    pumpkinCarving ? "Für dieses Kürbisschnitzmotiv: ruhige Bastelszene an einem einfachen Arbeitstisch, mehrere kleine unmarkierte Kürbisschnitzwerkzeuge sichtbar neben dem Kürbis, Kürbiskerne und Schalenreste auf dem Tisch, fertige geschnitzte Laternen im Hintergrund. Die Werkzeuge schneiden ohne Funken. Keine Speisen, keine Kücheninszenierung, keine Servierplatte und kein großes Küchenmesser als Hauptmotiv. Keine exakte Abbildung oder Ausstattung des beworbenen Modells behaupten." : "",
    "Grenzen: Keine Modellmerkmale, Zubehörteile oder Anwendungsschritte erfinden; ohne verifizierte Fakten nur die Produktkategorie zeigen. Keine Logos, Händlerbilder, Schrift im Bild oder irreführende Produktdarstellung.",
  ].filter(Boolean).join("\n");
}
