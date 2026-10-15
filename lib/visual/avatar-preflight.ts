import { heygenConfig } from "./providers/heygen";
import type { AvatarBriefing } from "./avatar-briefing";

// Preflight of an avatar product video BEFORE anything is paid. Pure: reads configuration NAMES/values of limits only,
// makes no network call and never starts a render. It answers: may this be rendered, what is missing, what would it cost?
//
//   HEYGEN_ENABLED=true                feature flag (default off – no avatar video is ever produced)
//   HEYGEN_API_KEY / _AVATAR_ID / _VOICE_ID / HEYGEN_MONTHLY_VIDEO_LIMIT   existing provider configuration
//   HEYGEN_COST_PER_SECOND_USD        planning estimate (default 0.05 = Avatar IV per HeyGen's developer docs, 0.1 credit/s
//                                      at 0.50 USD/credit). An ESTIMATE, not an invoice; HeyGen's own price shown before
//                                      generation is authoritative.
//   HEYGEN_MAX_VIDEO_SECONDS          hard ceiling per video (default 60)
//
// A paid render additionally needs the operator's explicit WhatsApp cost approval of exactly this briefing.

type Env = Record<string, string | undefined>;
export type Preflight = {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  estimate: { seconds: number; usd: number; basis: string };
  quota: { limit: number; used: number | null; remaining: number | null };
  apiVersion: "v2";
};

export function avatarPreflight(briefing: AvatarBriefing, input: { env?: Env; usedThisMonth?: number | null } = {}): Preflight {
  const env = input.env ?? process.env;
  const blockers: string[] = [], warnings: string[] = [];
  const enabled = env.HEYGEN_ENABLED?.trim() === "true";
  if (!enabled) blockers.push("HEYGEN_ENABLED ist nicht \"true\" – Avatar-Videos sind ausgeschaltet.");
  const config = heygenConfig({ apiKey: env.HEYGEN_API_KEY?.trim(), avatarId: env.HEYGEN_AVATAR_ID?.trim(), voiceId: env.HEYGEN_VOICE_ID?.trim(),
    monthlyLimit: Number(env.HEYGEN_MONTHLY_VIDEO_LIMIT ?? ""), enabled });
  for (const name of config.missing) blockers.push(`${name} fehlt.`);
  const maxSeconds = Number(env.HEYGEN_MAX_VIDEO_SECONDS) > 0 ? Number(env.HEYGEN_MAX_VIDEO_SECONDS) : 60;
  if (briefing.durationSeconds > maxSeconds) blockers.push(`Video zu lang: ${briefing.durationSeconds} s > ${maxSeconds} s (HEYGEN_MAX_VIDEO_SECONDS).`);
  if (briefing.aspectRatio !== "9:16") blockers.push("Seitenverhältnis muss 9:16 sein.");
  const spoken = briefing.scenes.map(scene => scene.spokenText).join(" ");
  if (spoken.length > 1500) blockers.push(`Sprechtext zu lang für einen Auftrag (${spoken.length} > 1500 Zeichen).`);
  if (!briefing.disclosure) blockers.push("Werbekennzeichnung fehlt.");
  if (briefing.scenes.some(scene => scene.productInteraction === "hold_in_hand") && !briefing.productReferences.length)
    blockers.push("Produkt in der Hand ohne echtes Produktbild mit Nutzungsrechten ist nicht zulässig.");
  if (!briefing.productReferences.length) warnings.push("Kein eigenes Produktbild: Produkt nur als Erwähnung, nicht sichtbar in Mias Hand.");
  if (briefing.scenes.some(scene => scene.productInteraction === "hold_in_hand"))
    warnings.push("Produkt in der Hand (Product Placement) ist eine Webstudio-Funktion; über die API nicht dokumentiert – dieser Teil braucht manuelle Produktion oder einen Szenenschnitt mit echtem Produktfoto.");
  warnings.push("Der aktuelle Provider-Code nutzt die HeyGen-API v2 (/v2/video/generate, 720 × 1280). Für 1080p/Avatar IV ist die v3-API (POST /v3/videos) vorgesehen; nicht live verifiziert.");
  const rate = Number(env.HEYGEN_COST_PER_SECOND_USD) > 0 ? Number(env.HEYGEN_COST_PER_SECOND_USD) : 0.05;
  const used = input.usedThisMonth ?? null;
  const remaining = config.monthlyLimit && used !== null ? Math.max(0, config.monthlyLimit - used) : null;
  if (remaining === 0) blockers.push(`Monatslimit erreicht (${used}/${config.monthlyLimit}).`);
  return { ready: blockers.length === 0, blockers, warnings,
    estimate: { seconds: briefing.durationSeconds, usd: Math.round(briefing.durationSeconds * rate * 100) / 100,
      basis: `${rate} USD/Sekunde (${env.HEYGEN_COST_PER_SECOND_USD ? "HEYGEN_COST_PER_SECOND_USD" : "Annahme Avatar IV laut HeyGen-Entwicklerdoku"}); maßgeblich ist der Preis, den HeyGen vor der Generierung anzeigt` },
    quota: { limit: config.monthlyLimit, used, remaining }, apiVersion: "v2" };
}

// Checklist for the finished video. Lip sync, gestures and product depiction cannot be measured automatically here:
// the operator confirms each point in the publication approval. Technical points are checked from file metadata.
export const VIDEO_QUALITY_CHECKLIST = [
  { id: "lipsync", label: "Lippenbewegung passt zum Sprechtext", automatic: false },
  { id: "natural", label: "Mia wirkt natürlich (Mimik, Blick, keine Verzerrungen)", automatic: false },
  { id: "gestures", label: "Gesten realistisch, Hände und Finger korrekt", automatic: false },
  { id: "product", label: "Produkt korrekt: Form, Proportionen, Bedienelemente, keine erfundenen Funktionen", automatic: false },
  { id: "facts", label: "Gesagtes stimmt mit den verifizierten Produktangaben überein", automatic: false },
  { id: "briefing", label: "Szenenfolge entspricht dem freigegebenen Briefing", automatic: false },
  { id: "disclosure", label: "Werbekennzeichnung sichtbar bzw. in der Caption", automatic: false },
  { id: "format", label: "9:16, Dauer im Rahmen, Ton vorhanden", automatic: true },
] as const;

export type TechnicalVideoCheck = { ok: boolean; issues: string[] };
// Technical check of an archived MP4 from its metadata (width/height/duration as reported by the provider or a probe).
export function technicalVideoCheck(meta: { width: number | null; height: number | null; durationSeconds: number | null; hasAudio: boolean | null }, briefing: AvatarBriefing): TechnicalVideoCheck {
  const issues: string[] = [];
  if (!meta.width || !meta.height) issues.push("Auflösung unbekannt.");
  else {
    if (Math.abs(meta.width / meta.height - 9 / 16) > 0.02) issues.push(`Seitenverhältnis ${meta.width}×${meta.height} ist nicht 9:16.`);
    if (meta.height < 1280) issues.push(`Auflösung zu gering (${meta.width}×${meta.height}).`);
  }
  if (meta.durationSeconds === null) issues.push("Dauer unbekannt.");
  else if (Math.abs(meta.durationSeconds - briefing.durationSeconds) > Math.max(5, briefing.durationSeconds * 0.3)) issues.push(`Dauer ${Math.round(meta.durationSeconds)} s weicht stark vom Briefing (${briefing.durationSeconds} s) ab.`);
  if (meta.hasAudio === false) issues.push("Kein Ton.");
  return { ok: issues.length === 0, issues };
}
