import type { VideoBriefing } from "./video-briefing";
import type { VideoPlan } from "./video-plan";

// WhatsApp texts of the daily topic video. Three separate decisions, each bound to its own message:
//   1. content approval (this proposal) – no cost, no production
//   2. cost approval (separate message, exact provider and estimate) – the only trigger of a paid render
//   3. publish approval (after the render, exact version) – existing central publish gate
const usd = (value: number | null) => value === null ? "–" : `ca. ${value.toFixed(2)} USD`;
const MAX = 3900;

export function videoProposalText(input: { contentId: string; briefing: VideoBriefing; plan: VideoPlan; revision: number; contentApproved: boolean; note?: string | null }) {
  const { briefing, plan } = input;
  const scenes = briefing.scenes.map(scene => `${scene.start}–${scene.end} s · ${scene.purpose}: „${scene.spokenText}“`);
  const text = [
    `Themenvideo-Vorschlag${input.revision > 1 ? ` (Überarbeitung ${input.revision})` : ""} · Content-ID ${input.contentId}`,
    "",
    `Thema: „${briefing.topic}“`,
    `Hook (0–3 s): „${briefing.hook.spoken}“`,
    `Inhalt: ${briefing.goal}. ${briefing.tension}`,
    `Länge: ${briefing.durationSeconds} s (Anbieter: ${plan.seconds} s) · Format: 9:16, Ziel 1080 × 1920${plan.resolution !== "–" && plan.resolution !== "1080×1920" ? ` (Anbieter liefert ${plan.resolution})` : ""}`,
    `Videoanbieter: ${plan.provider} · geschätzte Produktionskosten: ${usd(plan.estimateUsd)}${plan.estimateUsd !== null ? ` (${plan.basis})` : ""}`,
    plan.blockers.length ? `Rendering derzeit nicht möglich: ${plan.blockers.join(" ")}` : null,
    `Drehbuch: ${briefing.origin === "model" ? "KI-Modus (ein Modellaufruf, auf unbelegte Aussagen geprüft)" : "Referenzmodus (Regelvorlage aus den Scout-Daten, keine freie KI-Analyse)"}`,
    "",
    "Szenen und Sprechtext:",
    ...scenes,
    input.note ? `\n${input.note}` : null,
    "",
    input.contentApproved
      ? "Der Inhalt ist bereits freigegeben. Antworte erneut mit „Freigeben“, um die Kostenfreigabe neu anzufordern."
      : "Antworte auf DIESE Nachricht mit „Freigeben“ (nur INHALT freigeben – keine Kosten, keine Produktion), „Ablehnen“ oder einem Wunsch, z. B. „Anderer Aufhänger“, „Neues Thema“, „Weniger werblich“. Danach kommt eine eigene Kostenfreigabe.",
  ].filter((value): value is string => value !== null).join("\n");
  return text.length <= MAX ? text : `${text.slice(0, MAX - 1)}…`;
}

export function videoCostText(input: { contentId: string; briefing: VideoBriefing; plan: VideoPlan; monthSpent: number; monthBudget: number; maxPerVideo: number }) {
  const { plan } = input;
  if (plan.blockers.length || plan.estimateUsd === null) {
    return [`Inhalt freigegeben · Content-ID ${input.contentId}`, `„${input.briefing.topic}“`, "",
      `Eine Kostenfreigabe ist gerade nicht möglich: ${plan.blockers.join(" ")}`,
      "Optionen:", ...plan.options.map(option => `• ${option}`), "",
      "Es wird nichts produziert und nichts bezahlt. Sobald ein Anbieter freigeschaltet ist, antworte auf den Themenvideo-Vorschlag erneut mit „Freigeben“."].join("\n");
  }
  return [
    `Kostenfreigabe Themenvideo · Content-ID ${input.contentId}`,
    `„${input.briefing.topic}“`,
    "",
    `Anbieter: ${plan.provider} · Länge: ${plan.seconds} s · Auflösung: ${plan.resolution}`,
    `Geschätzte Kosten: ${usd(plan.estimateUsd)} (${plan.basis})`,
    `Höchstbetrag je Video: ${input.maxPerVideo.toFixed(2)} USD · Monatsbudget Themenvideos: ${input.monthSpent.toFixed(2)} von ${input.monthBudget.toFixed(2)} USD freigegeben`,
    ...plan.notes,
    "",
    "Antworte auf DIESE Nachricht mit „Freigeben“, um genau dieses Video einmal rendern zu lassen (kein zweiter Auftrag bei Wiederholungen), oder „Ablehnen“.",
    "Die Kostenfreigabe ist keine Veröffentlichungsfreigabe: Nach dem Rendern bekommst du das Video zur Prüfung und eine eigene Veröffentlichungsfreigabe.",
  ].join("\n");
}

// Checklist appended to the publish approval of a rendered topic video (operator confirms; nothing is auto-approved).
export const VIDEO_REVIEW_CHECKLIST = "Vor „Freigeben“ bitte im Video prüfen: Hook in den ersten 3 Sekunden · Stimme verständlich und passend zum Bild · keine erfundenen Aussagen, Marken oder Logos · Einblendungen lesbar · Ton ohne Störungen · 9:16.";
