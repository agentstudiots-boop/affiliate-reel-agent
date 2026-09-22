import { videoSchema } from "../schema";
import type { Brief, Generator } from "../agent";

export function videoAgent(brief: Brief, generate: Generator) {
  return generate("video", `Setze ausschließlich das vom Orchestrator ausgewählte Konzept in ein vollständiges Drehbuch um.
Die Geschichte bestimmt die Dauer: 10–40 Sekunden, bei Erklärung meist 20–40. Summe aller Szenendauern muss durationSeconds entsprechen.
Pro Szene konkrete visuelle Handlung, sprechbarer Dialog/Voiceover und Einblendung. Maximal ca. 2,5 gesprochene Wörter pro Sekunde.
Produktintegration, Voraussetzungen, CTA und Caption ausarbeiten. Feedback bei Revision gezielt beheben. Keine Videogenerierung auslösen.`, brief, videoSchema, () => {
    const { idea, opportunity } = brief;
    const vacuum = /vakuumier|vakuum.?versiegl/i.test(opportunity.product.name);
    const cta = new URL(opportunity.product.sourceUrl).pathname === "/s" ? "Passende Geräte in der verlinkten Auswahl ansehen." : "Eignung und Details beim verlinkten Produkt prüfen.";
    const scenes = vacuum ? [
      { durationSeconds: 5, visual: "Inszenierte Werbeszene am Familientisch: Oma schneidet das gebräunte Steak an. Nahaufnahme: rosa Kern, saftige Schnittfläche, Kräuterbutter schmilzt. Ihr überraschter Blick zu Papa.", audio: "Oma: Das hast du doch nicht selbst gemacht!", overlay: "Werbung · inszenierte Szene" },
      { durationSeconds: 4, visual: "Papa lächelt. Schnitt als Rückblende zur Küchenarbeitsfläche; Vakuumierer und separates Sous-vide-Gerät sichtbar.", audio: "Papa: Doch. Mit Vakuumierer und Sous-vide-Garer.", overlay: "Zwei Geräte, zwei Aufgaben" },
      { durationSeconds: 6, visual: "Rohes Steak in einen geeigneten Beutel legen, Beutelrand korrekt in das Vakuumiergerät führen und verschließen. Fleisch bleibt im Beutel.", audio: "Der Vakuumierer verschließt das Steak im geeigneten Beutel.", overlay: "1 · Für Sous-vide geeigneter Beutel" },
      { durationSeconds: 6, visual: "Verschlossenen Beutel mit Steak ins Wasserbad mit separatem Sous-vide-Garer geben. Schnitt kennzeichnet Zeitablauf; keine erfundenen Einstellungen zeigen.", audio: "Gegart wird anschließend im temperierten Wasserbad, mit einem separaten Garer.", overlay: "2 · Wasserbad + passendes Garprogramm" },
      { durationSeconds: 6, visual: "Nach dem Garen auspacken, trocken tupfen, in heißer Pfanne kurz anbraten. Bräunende Kruste, hörbares Brutzeln. Keine rohe und fertige Zubereitung vermischen.", audio: "Danach auspacken, trocken tupfen und für die Kruste kurz anbraten.", overlay: "3 · Die Kruste kommt aus der Pfanne" },
      { durationSeconds: 5, visual: "Zurück am Familientisch. Warmes Licht, rosa Anschnitt groß im Bild. Oma nimmt einen Bissen und nickt lächelnd.", audio: "Oma: Dann komm ich nächste Woche wieder!", overlay: "Eine Idee fürs nächste Familienessen" },
      { durationSeconds: 5, visual: "Produktübersicht mit beiden getrennten Geräten, passenden Beuteln und fertigem Teller. CTA im Schnitt ergänzen.", audio: cta, overlay: "Auswahl ansehen · Affiliate-Link" },
    ] : [
      { durationSeconds: 5, visual: `Konkrete Ausgangssituation zeigen: ${idea.situation}`, audio: idea.hook, overlay: "Werbung · Anwendungsidee" },
      { durationSeconds: 7, visual: `Anwendung inszenieren: ${idea.useCase}. Nur nach Prüfung der tatsächlichen Geräteeignung drehen.`, audio: "Hier zählt, ob das Produkt zu deiner Anwendung passt.", overlay: "Eignung am konkreten Modell prüfen" },
      { durationSeconds: 7, visual: `Nachvollziehbares Ergebnis zeigen: ${idea.benefit}. Keine unbestätigten Vorher-Nachher-Effekte simulieren.`, audio: "Prüfe Funktionen, Zubehör und Voraussetzungen für deinen Alltag.", overlay: "Funktion · Zubehör · Voraussetzungen" },
      { durationSeconds: 5, visual: `Das Produkt ${opportunity.product.name} im Kontext der Anwendung zeigen.`, audio: cta, overlay: "Werbung · Affiliate-Link" },
    ];
    return { format: "video" as const, title: idea.title, hook: idea.hook, useCase: idea.useCase,
      productIntegration: vacuum ? "Vakuumierer verschließt; separates Wasserbad gart; Pfanne erzeugt Kruste. Zubehör ist nicht automatisch im Lieferumfang." : idea.benefit,
      durationSeconds: scenes.reduce((s, x) => s + x.durationSeconds, 0), scenes, cta, disclosure: "Werbung | Affiliate-Link" as const,
      caption: `Werbung | ${idea.benefit} ${vacuum ? "Fiktive Familienszene, kein Testbericht. Sous-vide benötigt geeignete Beutel und ein separates temperiertes Wasserbad. Ergebnis abhängig von Lebensmittel und korrekter Zubereitung. Vakuumieren kann außerdem bei geeigneten Lebensmitteln und korrekter Lagerung die Haltbarkeit verlängern; Kühlung und Hygiene bleiben erforderlich." : "Redaktionelle Anwendungsidee; Eignung anhand der Herstellerangaben prüfen."} ${cta} Bei einem Kauf über den Affiliate-Link kann eine Provision anfallen.`,
      checks: ["Modelleignung und Herstellerhinweise prüfen.", "Dialog ist inszenierte Werbung, keine echte Kundenbewertung.", "Sprecher, Schnitt, Untertitel und Einblendungen produzieren. Dies ist ein Drehbuch, kein fertiges Video.", opportunity.product.notes || "Keine zusätzlichen Modellnachweise hinterlegt."],
    };
  });
}
