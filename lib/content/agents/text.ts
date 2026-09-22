import { textSchema } from "../schema";
import type { Brief, Generator } from "../agent";

export function textAgent(brief: Brief, generate: Generator) {
  return generate("text", "Schreibe einen glaubwürdigen Fach-, Empfehlungs- oder Community-Beitrag. Konkrete Anwendung und nachvollziehbare Entscheidungskriterien statt Werbefloskeln. Keine eigene Erfahrung ohne Nachweis, kein erfundenes Expertenzeugnis. Leserfrage, Produktintegration, Voraussetzungen, CTA und Werbekennzeichnung integrieren.", brief, textSchema, () => {
    const { idea, opportunity } = brief;
    const vacuum = /vakuumier|vakuum.?versiegl/i.test(opportunity.product.name);
    const body = vacuum
      ? "Beim Sous-vide-Steak haben Vakuumierer und Garer unterschiedliche Aufgaben: Der Vakuumierer verschließt das Fleisch im geeigneten Beutel. Das temperierte Wasserbad übernimmt das Garen. Die Kruste entsteht anschließend beim kurzen Anbraten in der Pfanne.\n\nFür den Einstieg zählen deshalb nicht nur das Gerät, sondern auch passende, für Sous-vide geeignete Beutel und ein separates Wasserbad mit Temperaturregelung. Welche Anwendungen unterstützt werden, muss am konkreten Modell geprüft werden.\n\nEin zweiter Anwendungsfall ist die Vorbereitung von Vorräten: Portionen verpacken, beschriften und lebensmittelgerecht kühlen oder einfrieren. Vakuumieren kann bei geeigneten Lebensmitteln und korrekter Lagerung die Haltbarkeit verlängern. Es ersetzt weder Kühlung noch Hygiene; eine pauschale Haltbarkeitsfrist lässt sich daraus nicht ableiten.\n\nWas wäre für euch im Alltag nützlicher: vorbereitete Portionen oder der Einstieg ins Sous-vide-Kochen?"
      : `${idea.situation}\n\nDabei geht es um diesen Anwendungsfall: ${idea.useCase}\n\n${opportunity.product.name} ist dafür eine Produktidee, deren Eignung am konkreten Modell zu prüfen ist. Entscheidend sind die tatsächlich unterstützten Funktionen, benötigtes Zubehör und die Voraussetzungen der Anwendung. Die vorliegenden Angaben sind kein eigener Produkttest.\n\n${idea.benefit}\n\nWelche dieser Fragen ist für euren Alltag ausschlaggebend?`;
    return { format: "text" as const, style: opportunity.goal === "community" ? "community" as const : "expert" as const,
      title: idea.title, hook: idea.hook, useCase: idea.useCase, productIntegration: idea.benefit,
      body: `Werbung | Affiliate-Link\n\n${idea.hook}\n\n${body}\n\nBei einem Kauf über den Affiliate-Link kann eine Provision anfallen.`,
      cta: new URL(opportunity.product.sourceUrl).pathname === "/s" ? "Die verlinkte Auswahl hilft beim Vergleich passender Produkte." : "Aktuelle Produktdetails über den gekennzeichneten Link prüfen.",
      disclosure: "Werbung | Affiliate-Link" as const, checks: ["Keine eigene Nutzung oder Fachqualifikation behaupten.", "Produktspezifische Angaben vor Veröffentlichung anhand der Quellen prüfen."],
    };
  });
}
