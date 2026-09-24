import { textSchema } from "../schema";
import type { Brief, Generator } from "../agent";

function shorten(value: string, max: number) {
  const clean = value.trim();
  if (clean.length <= max) return clean;
  const slice = clean.slice(0, max);
  const boundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  return boundary > max * 0.45 ? slice.slice(0, boundary + 1) : slice.replace(/\\s+\\S*$/, "").trim() + "…";
}

function reviseReferenceText(brief: Brief) {
  if (brief.previous?.format !== "text" || !brief.changeRequest) throw new Error("Vorheriger Text-Plan und Änderungsauftrag fehlen.");
  const request = brief.changeRequest.toLocaleLowerCase("de-DE");
  const next = structuredClone(brief.previous);
  let applied = false;

  if (/kürzer|kompakter|text kürzen|weniger text/.test(request)) {
    const paragraphs = next.body.split(/\\n\\n+/).map(part => part.trim()).filter(Boolean);
    const kept = paragraphs.length > 5 ? [paragraphs[0], ...paragraphs.slice(1, 4), paragraphs.at(-1)!] : paragraphs;
    next.body = shorten(kept.join("\\n\\n"), 1200);
    if (next.body.length < 120) next.body = brief.previous.body;
    applied = true;
  }
  if (/weniger werblich|nicht so werblich|sachlicher|neutraler/.test(request)) {
    next.style = "expert";
    next.cta = new URL(brief.opportunity.product.sourceUrl).pathname === "/s"
      ? "Bei Interesse kannst du die verlinkte Auswahl anhand der Herstellerangaben vergleichen."
      : "Bei Interesse kannst du die Angaben zum verlinkten Produkt prüfen.";
    next.body = next.body.replace(/Was wäre für euch[^?]*\\?/gi, "").replace(/Welche dieser Fragen[^?]*\\?/gi, "").trim();
    applied = true;
  }
  if (/fachlicher|mehr fachlich|mehr expertise|sachlich erklären/.test(request)) {
    next.style = "expert";
    next.body = next.body.replace(/\\n\\n+/g, "\\n\\n");
    applied = true;
  }
  if (/frage.{0,30}(ende|schluss)|community.?frage|mehr community/.test(request)) {
    next.style = "community";
    if (!/\\?\\s*$/.test(next.body)) next.body += "\\n\\nWelche Erfahrung oder welches Kriterium ist für euch bei dieser Anwendung entscheidend?";
    applied = true;
  }
  if (/(hook|überschrift|titel).{0,30}kürzer|kürzere.{0,20}(hook|überschrift|titel)/.test(request)) {
    next.hook = shorten(next.hook, 72);
    next.title = shorten(next.title, 72);
    applied = true;
  }
  if (/cta.{0,30}(ändern|neutral|sachlich|weniger werblich)|(ändern|neutral|sachlich).{0,30}cta/.test(request)) {
    next.cta = new URL(brief.opportunity.product.sourceUrl).pathname === "/s"
      ? "Bei Interesse kannst du die verlinkte Auswahl vergleichen."
      : "Bei Interesse kannst du die Produktangaben im Link prüfen.";
    applied = true;
  }
  if (!applied) throw new Error("Änderungswunsch im Referenzmodus nicht eindeutig umsetzbar. Bitte z. B. „kürzer“, „weniger werblich“, „fachlicher“, „Community-Frage am Ende“, „Hook kürzer“ oder „CTA sachlicher“ schreiben.");
  return textSchema.parse(next);
}

export function textAgent(brief: Brief, generate: Generator) {
  return generate("text", "Schreibe einen glaubwürdigen Fach-, Empfehlungs- oder Community-Beitrag. Konkrete Anwendung und nachvollziehbare Entscheidungskriterien statt Werbefloskeln. Keine eigene Erfahrung ohne Nachweis, kein erfundenes Expertenzeugnis. Leserfrage, Produktintegration, Voraussetzungen, CTA und Werbekennzeichnung integrieren.", brief, textSchema, () => {
    if (brief.changeRequest) return reviseReferenceText(brief);
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
