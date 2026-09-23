import type { WhatsAppIntent } from "../production/schema";

const approve = new Set([
  "freigeben",
  "freigabe",
  "genehmigt",
  "genehmigen",
  "ja freigeben",
  "ok freigeben",
  "okay freigeben",
  "start freigeben",
]);

const reject = new Set([
  "ablehnen",
  "abgelehnt",
  "nein",
  "stop",
  "stopp",
  "abbrechen",
]);

function normalize(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("de-DE")
    .replace(/[.!?;,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function classifyWhatsAppReply(body: string): { intent: WhatsAppIntent; feedback: string } {
  const normalized = normalize(body);
  if (approve.has(normalized)) return { intent: "approve", feedback: "" };
  if (reject.has(normalized)) return { intent: "reject", feedback: "" };
  return { intent: "changes_requested", feedback: body.trim() };
}
