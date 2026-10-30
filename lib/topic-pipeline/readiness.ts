import type { TopicCandidate } from "../topics/schema";
import type { TopicCopy } from "./copy";
import { MISSING_SPOKEN, type VideoBriefing } from "./video-briefing";

// Production readiness of a topic draft, checked before anything is offered to the operator as a proposal (propose) or
// delivered later (deliverHeldProposals). A fallback is allowed – a thin one is not: a draft without concrete content, with a
// cut-off sentence or with an internal editorial note in the audience text is never handed on as a usable production draft.
// No check is relaxed for this: the model copy is still claim-checked (copy.ts) and the model briefing validated
// (validBriefing); this only adds what a fallback must have on top.

export type DraftReadiness = { ready: boolean; reasons: string[] };

// Internal briefs and pipeline notes of the scout and the router. They steer the model; an audience must never read them.
const INTERNAL_NOTE = /produkte nur optional|ohne erfundene|ohne werbeversprechen|dein themenauftrag|nur belegte (?:fakten|hintergründe)|keine fremden bilder|ohne quelle keine behauptung|→/i;
// A sentence may not end on a word that needs a continuation („Produkte nur optional und ohne.“).
// Only words that never close a German sentence: separable particles („Wie gehst du das an?“) and pronouns („Wer kennt das?“) can.
const DANGLING_END = /(?:^|\s)(?:und|oder|ohne|für|zum|zur|den|dem|des|ein|eine|einen|einem|eines|aber|weil|dass|wenn|sowie|vom|im|beim)\s*[.…!?]*$/i;
const words = (text: string) => text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).length;
const MIN_TIP_WORDS = 6;       // one concrete point of a model copy (a handgrip, not „Erstmal tief durchatmen“)
const MIN_SOLUTION_WORDS = 8;  // the solution part of a video

// Concrete content the reference template may rephrase: an attributed source headline or a curated everyday situation.
// An operator order or a bare keyword has neither – only the model copy can make a draft of it.
export function hasSourceSubstance(candidate: TopicCandidate) {
  const news = candidate.source_signals.some(signal => signal.kind === "news" && !!signal.publisher);
  const curated = candidate.source_signals.some(signal => signal.source === "evergreen" || signal.source === "calendar");
  return news || (curated && candidate.audience_problem.trim().length > 0 && !/^Alltagsthema: /.test(candidate.audience_problem));
}

function textProblems(label: string, text: string, reasons: string[]) {
  if (INTERNAL_NOTE.test(text)) reasons.push(`${label}: interne Redaktionsnotiz im Publikumstext`);
}

export function draftReadiness(candidate: TopicCandidate, copy: TopicCopy, briefing: VideoBriefing | null = null): DraftReadiness {
  const reasons: string[] = [];
  if (copy.origin === "reference_template" && !hasSourceSubstance(candidate))
    reasons.push("Referenzvorlage ohne konkrete Inhalte (keine Quelle, kein kuratierter Alltagsfall) – der KI-Text fehlt");
  if (copy.origin === "model" && !copy.points.some(point => words(point.text) >= MIN_TIP_WORDS))
    reasons.push(`KI-Text ohne konkreten Punkt (mindestens ${MIN_TIP_WORDS} Wörter je Tipp)`);
  for (const [label, text] of [["Hook", copy.hook], ["Text", copy.body], ["Beitragstext", copy.caption], ["Frage", copy.question], ["CTA", copy.cta]] as const) textProblems(label, text, reasons);
  copy.points.forEach((point, index) => {
    textProblems(`Punkt ${index + 1}`, `${point.headline} ${point.text}`, reasons);
    if (DANGLING_END.test(point.text.trim())) reasons.push(`Punkt ${index + 1}: abgebrochener Satz`);
  });
  if (briefing) {
    for (const scene of briefing.scenes) {
      if (scene.spokenText.includes(MISSING_SPOKEN)) reasons.push(`Szene ${scene.index} (${scene.purpose}): kein vollständiger Satz passt in die Szenenlänge`);
      else if (DANGLING_END.test(scene.spokenText.trim())) reasons.push(`Szene ${scene.index} (${scene.purpose}): abgebrochener Satz`);
      textProblems(`Szene ${scene.index}`, scene.spokenText, reasons);
    }
    textProblems("Video-Beitragstext", `${briefing.platform.instagram.caption} ${briefing.platform.facebook.caption} ${briefing.platform.youtube.description}`, reasons);
    const solution = briefing.scenes.filter(scene => scene.purpose === "solution").map(scene => scene.spokenText).join(" ");
    if (words(solution.replace(MISSING_SPOKEN, "")) < MIN_SOLUTION_WORDS) reasons.push(`Lösungsteil des Videos zu dünn (mindestens ${MIN_SOLUTION_WORDS} gesprochene Wörter)`);
    if (briefing.origin === "reference_template" && copy.origin === "reference_template" && !candidate.source_signals.some(signal => signal.kind === "news" && !!signal.publisher))
      reasons.push("Video braucht konkrete Lösungsschritte; die Referenzvorlage kennt nur die Alltagssituation");
  }
  return { ready: reasons.length === 0, reasons: [...new Set(reasons)] };
}
