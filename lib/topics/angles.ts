import type { Cluster, Scored } from "./scoring";
import type { TrendType } from "./schema";

// Rule-based text templates (text_origin = "rule_template"). They only rephrase the source title and the
// computed timing; they never add facts, numbers, tests or promises. A model may later enrich them
// (text_origin = "model_enriched"), but the gate checks either version the same way.

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const clip = (value: string, length: number) => value.length > length ? `${value.slice(0, length - 1).replace(/\s+\S*$/, "")}…` : value;
const strip = (value: string) => value.replace(/\s+am \d{1,2}\. \p{L}+$/u, "").replace(/[„“"]/g, "").trim();

export type TopicTexts = { audienceProblem: string; whyNow: string; hook: string; angle: string; coreMessage: string; variant: number };

export function topicTexts(cluster: Cluster, type: TrendType, scored: Scored, now: Date, variant = 0): TopicTexts {
  const title = strip(cluster.title);
  const short = clip(title, 90);
  const snippet = cluster.signals.find(signal => signal.snippet && (signal.kind === "evergreen" || signal.kind === "calendar"))?.snippet ?? "";
  const publishers = [...new Set(cluster.signals.filter(signal => signal.kind === "news" && signal.publisher).map(signal => signal.publisher!))];
  const month = MONTHS[now.getUTCMonth()];
  const when = scored.daysUntilEvent !== null ? (scored.daysUntilEvent === 0 ? "heute" : scored.daysUntilEvent === 1 ? "morgen" : `in ${scored.daysUntilEvent} Tagen`) : null;
  const pick = <T,>(options: T[]) => options[variant % options.length];
  switch (type) {
    case "SEASONAL": case "EVENT":
      if (when) return { variant,
        audienceProblem: snippet ? `${short} steht an: ${snippet}.` : `${short} steht an und will vorbereitet sein.`,
        whyNow: `${short} ist ${when}; Vorbereitung lohnt sich jetzt.`,
        hook: pick([`${short} ist ${when} – daran solltest du jetzt denken`, `Kurz vor ${short}: das wird gern vergessen`, `${short} ${when}: so wird es entspannter`]),
        angle: snippet ? `Praktische Vorbereitung: ${snippet}` : `Praktische Vorbereitung auf ${short}`,
        coreMessage: `Konkrete, überprüfbare Schritte rund um ${short}, ohne Werbeversprechen.` };
      return { variant, audienceProblem: `${short} betrifft gerade viele im Alltag.`, whyNow: `Saisonal aktuell (${month}); ${publishers.length ? `berichtet von ${publishers.slice(0, 2).join(", ")}` : "aktuelles Signal"}.`,
        hook: pick([`${short}: was das jetzt für deinen Alltag heißt`, `${short} – so stellst du dich darauf ein`]), angle: "Alltagsfolgen und einfache Vorbereitung", coreMessage: `Was man bei ${short} praktisch beachten kann, ohne Panik.` };
    case "PRACTICAL_LIFE": case "EVERGREEN":
      return { variant,
        audienceProblem: snippet || `${short} kostet im Alltag Zeit und Nerven.`,
        whyNow: type === "PRACTICAL_LIFE" ? `Passt gerade zur Jahreszeit (${month}).` : "Zeitloses Alltagsproblem, das viele kennen.",
        hook: pick([`${short}? Diese einfachen Schritte helfen im Alltag`, `Kennst du das: ${clip(snippet || short, 70)}?`, `${short} – die häufigsten Fehler und was besser klappt`]),
        angle: pick(["Problem → einfache Lösungsschritte", "Typische Fehler → bessere Alternative", "Vorher/Nachher im Alltag"]),
        coreMessage: `Nachvollziehbare Alltagstipps zu ${short}; Produkte nur optional und ohne erfundene Eigenschaften.` };
    case "PRODUCT_ADJACENT":
      return { variant, audienceProblem: `Rund um ${short} suchen viele nach einer praktischen Lösung.`, whyNow: publishers.length ? `Aktuell Thema bei ${publishers.slice(0, 2).join(", ")}.` : "Aktuelles Suchinteresse.",
        hook: pick([`${short}: worauf es im Alltag wirklich ankommt`, `${short} – was davon braucht man wirklich?`]), angle: "Anwendungssituation → Funktion → nachvollziehbarer Nutzen",
        coreMessage: `Nüchterne Einordnung von ${short} anhand konkreter Alltagssituationen.` };
    case "ENTERTAINMENT":
      return { variant, audienceProblem: "Viele wollen wissen, worüber gerade gesprochen wird und ob es sich lohnt.", whyNow: `Aktuell in ${publishers.length || 1} Quelle(n).`,
        hook: pick([`Alle reden über ${short} – worum geht es eigentlich?`, `${short}: kurz eingeordnet`]), angle: "Kurz einordnen, eigene Meinung der Community abfragen",
        coreMessage: `Neutraler Überblick zu ${short} mit Frage an die Community; keine fremden Bilder, keine Gerüchte.` };
    case "CURIOSITY":
      return { variant, audienceProblem: "Lust auf eine kurze, überraschende Alltagsgeschichte.", whyNow: publishers.length ? `Aktuell gemeldet von ${publishers.slice(0, 2).join(", ")}.` : "Aktuelles Signal.",
        hook: pick([/^kurios/i.test(short) ? short : `Kurios: ${short}`, `Das gibt es wirklich: ${short.replace(/^kurios\p{L}*:?\s*/iu, "")}`]), angle: "Überraschung → Einordnung → Bezug zum eigenen Alltag", coreMessage: `Die belegte Meldung kurz erzählen und mit einer Alltagsfrage verbinden.` };
    case "SOCIAL_HYPE":
      return { variant, audienceProblem: "Viele sehen den Hype und fragen sich, was dran ist.", whyNow: "Gerade viel diskutiert.",
        hook: pick([`${short}: Was steckt hinter dem Hype?`, `${short} – lohnt sich das wirklich?`]), angle: "Hype nüchtern einordnen", coreMessage: `Einordnung ohne Übertreibung; was ist belegt, was nicht.` };
    case "SEARCH_TREND":
      return { variant, audienceProblem: `Viele suchen gerade nach ${short}.`, whyNow: "Hohes aktuelles Such- bzw. Aufrufinteresse.",
        hook: pick([`Gerade oft gesucht: ${short}`, `${short} – kurz erklärt`]), angle: "Kurz erklären, warum das Thema gesucht wird (nur mit Quelle)", coreMessage: `Nur belegte Hintergründe zu ${short}; ohne Quelle keine Behauptung.` };
    case "BREAKING_NEWS": default:
      return { variant, audienceProblem: `Die Meldung „${short}“ wirft Fragen für den Alltag auf.`, whyNow: publishers.length ? `Aktuell gemeldet von ${publishers.slice(0, 3).join(", ")}.` : "Aktuelle Meldung.",
        hook: pick([`${short} – was das für deinen Alltag heißt`, `${short}: die wichtigsten Punkte kurz erklärt`]), angle: "Nachricht → praktische Bedeutung", coreMessage: `Nur belegte Fakten aus den Quellen und deren Alltagsbedeutung.` };
  }
}
