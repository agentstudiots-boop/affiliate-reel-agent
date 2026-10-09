import { PLATFORMS, type Platform } from "../formats/catalog";
import { effectDecision } from "../security/runtime-guard";

// Central credential and capability check for the topic / multi-format pipeline.
// Single source of truth for: which services exist, which variables they need, which are present or missing,
// whether a platform is activated, and whether only a dry run or real publishing would be possible.
// It only ever reports variable NAMES; values are never read beyond "set / not set" (and the documented switches).

type Env = Record<string, string | undefined>;
// requires: every group must be satisfied; a group is satisfied if ANY of its alternatives is fully set.
type Requirement = { label: string; anyOf: string[][] };
export type ServiceKind = "platform" | "media_provider" | "model_provider" | "topic_source" | "core";
export type ServiceDefinition = {
  id: string; label: string; kind: ServiceKind;
  purpose: string;
  requires: Requirement[];           // needed for the service's real function (production or live publishing)
  optional: { name: string; purpose: string }[];
  enabled?: (env: Env) => { enabled: boolean; reason?: string };
  implemented: boolean;              // real client implemented in this repository
  liveVerified: boolean;             // verified against the real provider (false unless proven)
  neededFor: { dryRun: boolean; production: boolean; livePublishing: boolean };
};

const set = (env: Env, name: string) => !!env[name]?.trim();
const req = (label: string, ...anyOf: string[][]): Requirement => ({ label, anyOf });
const one = (name: string) => req(name, [name]);

export function activePlatforms(env: Env = process.env): Platform[] {
  const raw = env.TOPIC_PLATFORMS?.trim();
  if (!raw) return [...PLATFORMS];
  return raw.split(",").map(item => item.trim().toLowerCase()).filter((item): item is Platform => (PLATFORMS as readonly string[]).includes(item));
}
export const liveSwitchOn = (env: Env = process.env) => env.TOPIC_LIVE_PUBLISHING === "true";
const platformEnabled = (platform: Platform) => (env: Env) => activePlatforms(env).includes(platform)
  ? { enabled: true } : { enabled: false, reason: `nicht in TOPIC_PLATFORMS` };

const META_TOKEN = req("META_SYSTEM_USER_TOKEN oder META_PAGE_ACCESS_TOKEN", ["META_SYSTEM_USER_TOKEN"], ["META_PAGE_ACCESS_TOKEN"]);
const BLOB = one("BLOB_READ_WRITE_TOKEN");

export const SERVICES: ServiceDefinition[] = [
  { id: "instagram", label: "Instagram", kind: "platform", purpose: "Bild, Karussell und Reel über die Instagram Graph API (bestehende Meta-Anbindung)",
    requires: [META_TOKEN, one("META_PAGE_ID"), one("META_INSTAGRAM_USER_ID"), BLOB],
    optional: [{ name: "META_GRAPH_API_VERSION", purpose: "Graph-API-Version (Standard v25.0)" }, { name: "META_BUSINESS_ID", purpose: "Verbindungsprüfung" }],
    enabled: platformEnabled("instagram"), implemented: true, liveVerified: false, neededFor: { dryRun: false, production: false, livePublishing: true } },
  { id: "facebook", label: "Facebook", kind: "platform", purpose: "Text, Foto, Album und Video auf der Facebook-Seite (bestehende Meta-Anbindung)",
    requires: [META_TOKEN, one("META_PAGE_ID")], optional: [{ name: "META_GRAPH_API_VERSION", purpose: "Graph-API-Version" }],
    enabled: platformEnabled("facebook"), implemented: true, liveVerified: false, neededFor: { dryRun: false, production: false, livePublishing: true } },
  { id: "tiktok", label: "TikTok", kind: "platform", purpose: "Video und Foto-Slideshow über die TikTok Content Posting API (Direct Post)",
    requires: [req("TIKTOK_ACCESS_TOKEN oder TIKTOK_REFRESH_TOKEN + TIKTOK_CLIENT_KEY + TIKTOK_CLIENT_SECRET", ["TIKTOK_ACCESS_TOKEN"], ["TIKTOK_REFRESH_TOKEN", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"])],
    optional: [{ name: "TIKTOK_PRIVACY_LEVEL", purpose: "Sichtbarkeit, Standard SELF_ONLY bis zur App-Prüfung" }],
    enabled: platformEnabled("tiktok"), implemented: true, liveVerified: false, neededFor: { dryRun: false, production: false, livePublishing: true } },
  { id: "youtube", label: "YouTube Shorts", kind: "platform", purpose: "Shorts-Upload über die YouTube Data API v3 (resumable upload)",
    requires: [one("YOUTUBE_CLIENT_ID"), one("YOUTUBE_CLIENT_SECRET"), one("YOUTUBE_REFRESH_TOKEN")],
    optional: [{ name: "YOUTUBE_PRIVACY_STATUS", purpose: "public/unlisted/private, Standard private" }, { name: "YOUTUBE_CATEGORY_ID", purpose: "Kategorie, Standard 26 (Howto & Style)" }],
    enabled: platformEnabled("youtube"), implemented: true, liveVerified: false, neededFor: { dryRun: false, production: false, livePublishing: true } },
  { id: "x", label: "X", kind: "platform", purpose: "Posts mit Bildern oder Video über die X API v2 (OAuth 1.0a User Context)",
    requires: [one("X_API_KEY"), one("X_API_SECRET"), one("X_ACCESS_TOKEN"), one("X_ACCESS_TOKEN_SECRET")], optional: [],
    enabled: platformEnabled("x"), implemented: true, liveVerified: false, neededFor: { dryRun: false, production: false, livePublishing: true } },

  { id: "replicate", label: "Replicate (Bilder, Router, Texte)", kind: "media_provider", purpose: "Bildgenerierung (FLUX), semantischer WhatsApp-Router, optionale KI-Texte",
    requires: [one("REPLICATE_API_TOKEN")], optional: [{ name: "REPLICATE_IMAGE_MODEL", purpose: "Bildmodell (unterstützte FLUX-Modelle)" }],
    implemented: true, liveVerified: false, neededFor: { dryRun: false, production: true, livePublishing: false } },
  { id: "blob", label: "Vercel Blob (Medienablage)", kind: "core", purpose: "Ablage generierter Bilder, Textgrafiken und Videos", requires: [BLOB], optional: [],
    implemented: true, liveVerified: false, neededFor: { dryRun: false, production: true, livePublishing: true } },
  { id: "heygen", label: "HeyGen (Avatar-Video)", kind: "media_provider", purpose: "Avatar-Videos hinter der AvatarVideoProvider-Schnittstelle",
    requires: [one("HEYGEN_API_KEY"), one("HEYGEN_AVATAR_ID"), one("HEYGEN_VOICE_ID"), one("HEYGEN_MONTHLY_VIDEO_LIMIT")], optional: [],
    implemented: true, liveVerified: false, neededFor: { dryRun: false, production: true, livePublishing: false } },
  { id: "runway", label: "Runway (Standard-Video)", kind: "media_provider", purpose: "Standard-Video über die bestehende Runway-Anbindung (opt-in)",
    requires: [one("RUNWAYML_API_SECRET")], optional: [{ name: "RUNWAY_MONTHLY_BUDGET_CREDITS", purpose: "Monatsbudget (bestehend)" }],
    enabled: env => env.TOPIC_STANDARD_VIDEO_PROVIDER === "runway" ? { enabled: true } : { enabled: false, reason: "TOPIC_STANDARD_VIDEO_PROVIDER≠runway" },
    implemented: true, liveVerified: false, neededFor: { dryRun: false, production: true, livePublishing: false } },
  { id: "openai", label: "OpenAI (Bild-Fallback Produkt-Pipeline)", kind: "model_provider", purpose: "Nur Produkt-Pipeline: Bildprovider, wenn Replicate fehlt; Themen-Pipeline nutzt ihn nicht",
    requires: [one("OPENAI_API_KEY")], optional: [{ name: "OPENAI_IMAGE_MODEL", purpose: "Bildmodell" }],
    implemented: true, liveVerified: false, neededFor: { dryRun: false, production: false, livePublishing: false } },
  { id: "tavily", label: "Tavily News (Themenquelle)", kind: "topic_source", purpose: "Aktuelle Meldungen für den Themen-Scout",
    requires: [one("TAVILY_API_KEY")], optional: [], implemented: true, liveVerified: false, neededFor: { dryRun: false, production: false, livePublishing: false } },
  { id: "google_news", label: "Google News RSS (Themenquelle)", kind: "topic_source", purpose: "Öffentlicher RSS-Feed, kein Schlüssel", requires: [], optional: [],
    enabled: env => env.TOPIC_SOURCE_GOOGLE_NEWS === "false" ? { enabled: false, reason: "TOPIC_SOURCE_GOOGLE_NEWS=false" } : { enabled: true },
    implemented: true, liveVerified: false, neededFor: { dryRun: false, production: false, livePublishing: false } },
  { id: "google_trends", label: "Google Trends RSS (Themenquelle)", kind: "topic_source", purpose: "Öffentlicher Trending-Feed, kein Schlüssel", requires: [], optional: [],
    enabled: env => env.TOPIC_SOURCE_GOOGLE_TRENDS === "false" ? { enabled: false, reason: "TOPIC_SOURCE_GOOGLE_TRENDS=false" } : { enabled: true },
    implemented: true, liveVerified: false, neededFor: { dryRun: false, production: false, livePublishing: false } },
  { id: "wikipedia", label: "Wikimedia Pageviews (Themenquelle)", kind: "topic_source", purpose: "Offizielle REST-API, kein Schlüssel", requires: [], optional: [],
    enabled: env => env.TOPIC_SOURCE_WIKIPEDIA === "false" ? { enabled: false, reason: "TOPIC_SOURCE_WIKIPEDIA=false" } : { enabled: true },
    implemented: true, liveVerified: false, neededFor: { dryRun: false, production: false, livePublishing: false } },
  { id: "whatsapp", label: "WhatsApp (Freigaben)", kind: "core", purpose: "Vorschläge, Freigaben, Rückmeldungen (bestehende Anbindung)",
    requires: [req("WHATSAPP_ACCESS_TOKEN", ["WHATSAPP_ACCESS_TOKEN"], ["WHATTSAPP_ACCESS_TOKEN"]), req("WHATSAPP_PHONE_NUMBER_ID", ["WHATSAPP_PHONE_NUMBER_ID"], ["WHATTSAPP_PHONE_NUMBER_ID"]),
      one("WHATSAPP_VERIFY_TOKEN"), one("META_APP_SECRET"), one("WHATSAPP_APPROVER_WA_ID")], optional: [],
    implemented: true, liveVerified: true, neededFor: { dryRun: true, production: true, livePublishing: true } },
  { id: "database", label: "Postgres", kind: "core", purpose: "Jobs, Freigaben, Historie", requires: [one("DATABASE_URL")], optional: [],
    implemented: true, liveVerified: true, neededFor: { dryRun: true, production: true, livePublishing: true } },
  { id: "cron", label: "Cron-Schutz", kind: "core", purpose: "Authentifizierung von /api/cron/topic-scout", requires: [one("CRON_SECRET")], optional: [],
    implemented: true, liveVerified: true, neededFor: { dryRun: true, production: true, livePublishing: true } },
  { id: "landing", label: "Landingpage (Profil-Link)", kind: "core", purpose: "Ziel des „Link im Profil“-Hinweises (Instagram, TikTok, YouTube)",
    requires: [one("TOPIC_LANDING_URL")], optional: [], implemented: true, liveVerified: false, neededFor: { dryRun: false, production: false, livePublishing: false } },
];

export type ServiceState = "bereit" | "nur_dry_run" | "blockiert" | "nicht_aktiviert";
export type ServiceCapability = {
  id: string; label: string; kind: ServiceKind; enabled: boolean; state: ServiceState;
  required: string[]; present: string[]; missing: string[];
  can: { dryRun: boolean; produce: boolean; livePublish: boolean };
  reason: string;
};

function evaluate(definition: ServiceDefinition, env: Env): ServiceCapability {
  const enabledState = definition.enabled ? definition.enabled(env) : { enabled: true };
  const required = [...new Set(definition.requires.flatMap(group => group.anyOf.flat()))];
  const present = required.filter(name => set(env, name));
  const missingGroups = definition.requires.filter(group => !group.anyOf.some(names => names.every(name => set(env, name))));
  const missing = missingGroups.map(group => group.label);
  const credentialsOk = missing.length === 0;
  const platform = definition.kind === "platform";
  const live = platform && enabledState.enabled && credentialsOk && liveSwitchOn(env);
  const state: ServiceState = !enabledState.enabled ? "nicht_aktiviert" : !credentialsOk ? "blockiert" : platform && !liveSwitchOn(env) ? "nur_dry_run" : "bereit";
  const reason = state === "nicht_aktiviert" ? `nicht aktiviert (${enabledState.reason ?? "ausgeschaltet"})`
    : state === "blockiert" ? `blockiert – ${missing.join(", ")} fehlt`
      : state === "nur_dry_run" ? "Zugang vorhanden, Live-Veröffentlichung aus (TOPIC_LIVE_PUBLISHING) – nur Dry-Run" : "bereit";
  return { id: definition.id, label: definition.label, kind: definition.kind, enabled: enabledState.enabled, state, required, present, missing,
    can: { dryRun: platform ? enabledState.enabled : true, produce: !platform && enabledState.enabled && credentialsOk, livePublish: live }, reason };
}

export function checkCapabilities(env: Env = process.env): ServiceCapability[] { return SERVICES.map(definition => evaluate(definition, env)); }
export function capabilityOf(id: string, env: Env = process.env): ServiceCapability {
  const definition = SERVICES.find(item => item.id === id);
  if (!definition) throw new Error(`unknown_service:${id}`);
  return evaluate(definition, env);
}

// The one question the publish gate asks: may this platform be published live right now?
// Content origins that share the distribution layer. "product_pipeline" = affiliate posts of the existing product
// pipeline; "topic_pipeline" = topic posts (default).
export type ContentOrigin = "topic_pipeline" | "product_pipeline";
// Facebook and Instagram are the product pipeline's existing live channels: after its own explicit WhatsApp publication
// approval they publish today, without TOPIC_* switches, through the existing Meta connection checks. That behaviour is
// kept exactly. Every other platform for affiliate posts follows the same rules as topic posts.
export const PRODUCT_PIPELINE_LIVE_CHANNELS: readonly string[] = Object.freeze(["facebook", "instagram"]);

export function livePublishCapability(platform: string, env: Env = process.env, origin: ContentOrigin = "topic_pipeline"): { ok: true } | { ok: false; reason: "live_publishing_disabled" | "platform_not_enabled" | "credentials_missing" | "non_production_environment"; missing: string[] } {
  // Preview/development deployments never publish (they may hold production credentials). Applies to every origin.
  if (!effectDecision("publish", env).ok) return { ok: false, reason: "non_production_environment", missing: [] };
  if (!(PLATFORMS as readonly string[]).includes(platform)) return { ok: false, reason: "platform_not_enabled", missing: [] };
  if (origin === "product_pipeline" && PRODUCT_PIPELINE_LIVE_CHANNELS.includes(platform)) return { ok: true };
  const capability = capabilityOf(platform, env);
  if (!capability.enabled) return { ok: false, reason: "platform_not_enabled", missing: [] };
  if (capability.missing.length) return { ok: false, reason: "credentials_missing", missing: capability.missing };
  if (!liveSwitchOn(env)) return { ok: false, reason: "live_publishing_disabled", missing: [] };
  return { ok: true };
}

// Readable lines for WhatsApp "Status" and the dry-run report. Names only, never values.
export function capabilityLines(env: Env = process.env, kinds: ServiceKind[] = ["platform", "media_provider"]) {
  return checkCapabilities(env).filter(item => kinds.includes(item.kind)).map(item => `${item.label}: ${item.reason}`);
}
