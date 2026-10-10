// Architecture model of the Jarvis system for the 3D Command Center.
//
// Static, hand-maintained inventory derived from the repository code and docs (docs/CREDENTIALS.md,
// docs/TOPIC_PIPELINE_ACTIVATION.md, docs/PREVIEW_ISOLATION.md, tests/). It contains NO runtime data and NO secrets.
// Statuses are findings of the code review, not live telemetry: nothing here claims that an agent is working right now.
// Rules: do not invent components; "live_verified" requires documented proof against the real provider/production.

export type ComponentStatus = "live_verified" | "tested" | "unverified" | "disabled" | "planned" | "faulty";
export type ComponentKind = "orchestrator" | "agent" | "module" | "provider" | "platform" | "infra" | "guard" | "external";
export type ClusterId = "core" | "research" | "creative" | "quality" | "media" | "approval" | "publishing" | "infra";
export type EdgeKind = "orchestration" | "data" | "approval" | "publishing" | "external";

export type ArchNode = {
  id: string;
  label: string;
  kind: ComponentKind;
  cluster: ClusterId;
  status: ComponentStatus;
  summary: string;
  responsibilities: string[];
  /** Repository paths (evidence), relative to the repo root. */
  code: string[];
  /** Automated tests that cover the component (mock based unless stated otherwise). */
  tests: string[];
  /** What is missing for the next status level; empty if nothing is known to be missing. */
  gaps: string[];
  /** Environment variable NAMES only. Never values. */
  env?: string[];
};
export type ArchEdge = { id: string; from: string; to: string; kind: EdgeKind; label: string };

export const STATUS_META: Record<ComponentStatus, { label: string; color: string; description: string }> = {
  live_verified: { label: "Live verifiziert", color: "#3ddc84", description: "Laut Repo-Dokumentation produktiv gegen den echten Dienst genutzt/geprüft." },
  tested: { label: "Implementiert & getestet", color: "#4da3ff", description: "Automatisierte Tests (Mocks/PGlite) vorhanden, kein Live-Nachweis." },
  unverified: { label: "Nicht vollständig verifiziert", color: "#ffd24a", description: "Implementiert, aber ohne ausreichende Tests oder Live-Nachweis." },
  disabled: { label: "Deaktiviert", color: "#8a93a3", description: "Implementiert, aber per Feature-Flag/Cron nicht aktiv." },
  planned: { label: "Geplant / nicht implementiert", color: "#5b6472", description: "Im Code nicht vorhanden oder nur als Schnittstelle vorgesehen." },
  faulty: { label: "Nachweislicher Fehler", color: "#ff5c5c", description: "Reproduzierter Fehler. Aktuell ist keiner belegt." },
};
export const CLUSTER_META: Record<ClusterId, { label: string; color: string }> = {
  core: { label: "Orchestrierung", color: "#7cf5ff" },
  research: { label: "Recherche & Themen", color: "#b48cff" },
  creative: { label: "Kreativ & Content-Agenten", color: "#ff9ad5" },
  quality: { label: "Qualität & Regeln", color: "#ffb86b" },
  media: { label: "Medien & Video-Provider", color: "#6bffb0" },
  approval: { label: "WhatsApp & Freigaben", color: "#ffe46b" },
  publishing: { label: "Multichannel-Publishing", color: "#6bb5ff" },
  infra: { label: "Infrastruktur & Sicherheit", color: "#a0a8b8" },
};
export const EDGE_META: Record<EdgeKind, { label: string; color: string }> = {
  orchestration: { label: "Orchestrierung", color: "#7cf5ff" },
  data: { label: "Datenübertragung", color: "#b48cff" },
  approval: { label: "Freigabeprozess", color: "#ffe46b" },
  publishing: { label: "Publishing", color: "#6bb5ff" },
  external: { label: "Externe API", color: "#ff9ad5" },
};
export const KIND_LABEL: Record<ComponentKind, string> = {
  orchestrator: "Orchestrator", agent: "Eigenständiger Spezialagent (nur über Orchestrator)", module: "Internes Modul / Regel-Code", provider: "Video-/Bild-Provider",
  platform: "Veröffentlichungsplattform", infra: "Infrastruktur", guard: "Sicherheits-/Freigabeschranke", external: "Externer Dienst",
};

const n = (node: ArchNode): ArchNode => node;

export const NODES: ArchNode[] = [
  n({ id: "jarvis", label: "Jarvis (Content-Orchestrator)", kind: "orchestrator", cluster: "core", status: "tested",
    summary: "Zentrale Steuerung der Content-Planung. Einziger Ort, der Spezialagenten importiert und beauftragt.",
    responsibilities: ["Opportunity prüfen, Ideen gewichten, Format wählen", "Entwürfe validieren, max. 2 automatische Revisionen, max. 8 Modellaufrufe", "Übergabe zur Inhaltsfreigabe; startet weder Medienproduktion noch Veröffentlichung"],
    code: ["lib/orchestrator.ts", "lib/content/orchestrator.ts", "lib/content/schema.ts"], tests: ["tests/content.test.cjs", "tests/content-strategy.test.cjs", "tests/pipeline-recovery.test.cjs"],
    gaps: ["Kein Live-Nachweis des KI-Modus; Referenzmodus ist regelbasiert (kein freier Produktanalyst)"] }),
  n({ id: "topic-orchestrator", label: "Themen-Pipeline-Orchestrator", kind: "orchestrator", cluster: "core", status: "disabled",
    summary: "Scout → Vorschlag → Freigaben → Produktion → Multichannel-Verteilung für Themen-/Multi-Format-Inhalte.",
    responsibilities: ["Themenvorschläge per WhatsApp", "Master Content + Plattformvarianten", "Zwei getrennte Freigaben (Produktion, Veröffentlichung)"],
    code: ["lib/topic-pipeline/orchestrator.ts", "lib/topic-pipeline/cron.ts", "app/api/cron/topic-scout/route.ts"], tests: ["tests/topic-pipeline.test.cjs", "tests/dry-run-e2e.test.cjs", "tests/topic-cron.test.cjs", "tests/topic-route.test.cjs"],
    gaps: ["TOPIC_PIPELINE_ENABLED nicht gesetzt (bewusst)", "Cron nicht in vercel.json", "Preview-Isolation, Migration 034 und Vision vorher live prüfen"], env: ["TOPIC_PIPELINE_ENABLED", "TOPIC_LIVE_PUBLISHING", "TOPIC_PLATFORMS"] }),
  n({ id: "executive-agent", label: "Executive-Agent", kind: "agent", cluster: "core", status: "planned",
    summary: "Nur als Schnittstelle vorgesehen. Darf ohne geprüfte Codeänderung keine Freigaben erteilen.",
    responsibilities: ["Spätere Freigabeinstanz (ApprovalAuthorityKind)"], code: ["lib/publishing/authority.ts"], tests: ["tests/publish-approval-gate.test.cjs"],
    gaps: ["Kein Agentencode vorhanden; aktive Instanz ist ausschließlich der WhatsApp-Betreiber"] }),

  n({ id: "trend-agent", label: "Trendscout-Agent", kind: "agent", cluster: "research", status: "tested",
    summary: "Spezialagent: bewertet Recherche-Belege und Historie zu strukturierten Chancen. Keine Tools, keine Seiteneffekte.",
    responsibilities: ["Chancen aus Belegen ableiten", "Recherche selbst läuft im Orchestrator"], code: ["lib/content/agents/trend.ts", "lib/content/trend-scout.ts", "lib/content/trend.ts"],
    tests: ["tests/trend-agent.test.cjs"], gaps: ["Live-Lauf mit Modell/Tavily nicht belegt"] }),
  n({ id: "product-scout", label: "Produkt-Scout", kind: "module", cluster: "research", status: "live_verified",
    summary: "Regelbasierte Produktideen (Seeds) plus Tavily-Recherche für die Produkt-Pipeline.",
    responsibilities: ["Dauerläufer/Saison-/Trendprodukte vorschlagen", "Content-Chancen je Idee"], code: ["lib/agents/product-scout.ts", "lib/agents/content-chances.ts", "lib/tavily.ts"],
    tests: ["tests/daily-automation.test.cjs", "tests/trend-agent.test.cjs"], gaps: [], env: ["TAVILY_API_KEY"] }),
  n({ id: "product-reviewer", label: "Produkt-Prüfung", kind: "module", cluster: "research", status: "tested",
    summary: "Prüft Kandidaten gegen Quellen und Amazon-Produktdaten; Quellen sind kein Nachweis einzelner Eigenschaften.",
    responsibilities: ["Quellenrecherche", "Produktidentität (ASIN) prüfen"], code: ["lib/agents/product-reviewer.ts", "lib/product-resolver.ts", "lib/amazon.ts"], tests: ["tests/product-contract.test.cjs", "tests/affiliate-guard.test.cjs"], gaps: [] }),
  n({ id: "topic-scout", label: "Themen-Scout", kind: "module", cluster: "research", status: "disabled",
    summary: "Findet, bewertet und dedupliziert Themen aus Google News/Trends, Wikipedia und optional Tavily.",
    responsibilities: ["Signale sammeln, bewerten, Historie/Wiederholungen prüfen", "Gate gegen ungeeignete Themen"], code: ["lib/topics/scout.ts", "lib/topics/discovery.ts", "lib/topics/gate.ts", "lib/topics/sources/"],
    tests: ["tests/topic-scout.test.cjs"], gaps: ["Quellen-Feeds live nicht geprüft (Sandbox gesperrt)"], env: ["TOPIC_SOURCE_GOOGLE_NEWS", "TOPIC_SOURCE_GOOGLE_TRENDS", "TOPIC_SOURCE_WIKIPEDIA", "TAVILY_API_KEY"] }),

  n({ id: "creative-agent", label: "Creative-Agent", kind: "agent", cluster: "creative", status: "tested",
    summary: "Entwickelt drei Ideen (Video, Bild, Text) mit Alltagssituation, Story, Nutzen, Voraussetzungen und Cross-Sell.",
    responsibilities: ["Anwendungssituation vor Produktmerkmal", "Zubehör benennen, keine erfundenen Fakten"], code: ["lib/content/agents/creative.ts", "lib/content/creative-quality.ts"], tests: ["tests/creative-quality.test.cjs", "tests/content.test.cjs"],
    gaps: ["Referenzmodus: Vorlagen/Regeln; KI-Modus nicht live belegt"] }),
  n({ id: "video-agent", label: "Video-Agent", kind: "agent", cluster: "creative", status: "tested",
    summary: "Schreibt 10–40-Sekunden-Drehbücher (Szenen, Audio, Overlay).", responsibilities: ["Drehbuch gemäß SCRIPT_WRITER_MANIFEST"], code: ["lib/content/agents/video.ts"], tests: ["tests/content.test.cjs", "tests/video-revision.test.cjs"],
    gaps: ["Schnitt, Ton und Untertitel sind ein separater Produktionsschritt"] }),
  n({ id: "image-agent", label: "Bild-Agent", kind: "agent", cluster: "creative", status: "tested",
    summary: "Liefert Layouts, Prompts und Alt-Texte für Einzelbild/Carousel.", responsibilities: ["Bildbriefing"], code: ["lib/content/agents/image.ts", "lib/content/image-brief.ts"], tests: ["tests/content.test.cjs", "tests/image-quality.test.cjs"], gaps: [] }),
  n({ id: "text-agent", label: "Text-Agent", kind: "agent", cluster: "creative", status: "tested",
    summary: "Liefert Textpost-Entwürfe.", responsibilities: ["Textentwurf"], code: ["lib/content/agents/text.ts", "lib/content/editorial-copy.ts"], tests: ["tests/content.test.cjs"], gaps: [] }),
  n({ id: "marketing-agent", label: "Marketing-Agent", kind: "agent", cluster: "creative", status: "tested",
    summary: "Schlägt Plattform, Anpassungen, Linkplatzierung und Messgrößen vor. Veröffentlicht selbst nichts.", responsibilities: ["Plattformempfehlung", "Link-/CTA-Platzierung"], code: ["lib/content/agents/marketing.ts"], tests: ["tests/content.test.cjs"], gaps: [] }),
  n({ id: "script-writer", label: "Drehbuch-Regelwerk (historisch)", kind: "module", cluster: "creative", status: "tested",
    summary: "Regel-/vorlagenbasierter Drehbuch-Endpunkt; Vakuumierer-Beispiel ist Referenz, keine freie KI-Analyse.", responsibilities: ["Kuratierte Produktfamilien-Vorlagen"],
    code: ["lib/agents/script-writer.ts", "docs/SCRIPT_WRITER_MANIFEST.md"], tests: ["tests/content.test.cjs"], gaps: [] }),

  n({ id: "format-router", label: "Format-Router", kind: "module", cluster: "quality", status: "tested",
    summary: "Wählt Format (Text, Einzelbild, Karussell, Standard-/Avatar-Video) nach Regeln.", responsibilities: ["Formatentscheidung", "Betreiber-Overrides"], code: ["lib/formats/router.ts", "lib/formats/catalog.ts", "lib/formats/override.ts"], tests: ["tests/format-router.test.cjs"], gaps: [] }),
  n({ id: "vision-gate", label: "Bild-Qualitätsprüfung (Vision)", kind: "module", cluster: "quality", status: "unverified",
    summary: "Prüft das tatsächlich erzeugte Bild gegen das strukturierte Briefing; Budget, Feedback und Lernen. Kein eigener Agent.",
    responsibilities: ["Prompt-Prüfung", "Visuelles Quality Gate", "Strukturiertes Feedback ans Briefing"], code: ["lib/content/image-quality/", "db/migrations/034_image_quality.sql"],
    tests: ["tests/image-quality.test.cjs", "tests/fallback-chain.test.cjs"], gaps: ["Migration 034 nicht produktiv verifiziert", "Vision-Live-Test fehlt (scripts/vision-smoke-test.cjs, docs/IMAGE_QUALITY_VERIFICATION.md)"] }),
  n({ id: "affiliate-guard", label: "Affiliate-/Produktvertrag", kind: "guard", cluster: "quality", status: "tested",
    summary: "Produktidentität, Claim-Unterstützung und Link-Regeln. Keine unbeabsichtigten Affiliate-Link-Aufrufe.", responsibilities: ["ASIN-Bindung", "Link-Policy je Plattform"], code: ["lib/affiliate-guard.ts", "lib/content/product-contract.ts", "lib/distribution/link-policy.ts"], tests: ["tests/affiliate-guard.test.cjs", "tests/product-contract.test.cjs"], gaps: [] }),

  n({ id: "visual-engine", label: "Visual Engine", kind: "module", cluster: "media", status: "tested",
    summary: "Bilder, Textgrafiken, Karussells und Video-Auftragssteuerung für die Themen-Pipeline inkl. Fallback-Kette.", responsibilities: ["Provider-Auswahl", "Ledger/Budget", "Fallbacks"], code: ["lib/visual/engine.ts", "lib/visual/ledger.ts", "lib/visual/video.ts"], tests: ["tests/visual-engine.test.cjs", "tests/fallback-chain.test.cjs"], gaps: ["Themen-Bilder nicht live geprüft"] }),
  n({ id: "replicate", label: "Replicate (FLUX, Router)", kind: "provider", cluster: "media", status: "live_verified",
    summary: "Bildgenerierung (FLUX) und semantischer WhatsApp-Router; Produkt-Pipeline produktiv, Themen-Bilder nicht.", responsibilities: ["Bilder", "Routing/Texte"], code: ["lib/content/providers/replicate-image.ts", "lib/visual/providers/replicate.ts", "lib/whatsapp/route-llm.ts"],
    tests: ["tests/replicate-image.test.cjs", "tests/whatsapp-router.test.cjs"], gaps: ["Drosselung (429) beachten"], env: ["REPLICATE_API_TOKEN", "REPLICATE_IMAGE_MODEL"] }),
  n({ id: "openai-image", label: "OpenAI-Bild (Fallback)", kind: "provider", cluster: "media", status: "tested",
    summary: "Nur Produkt-Pipeline: Bildprovider, wenn Replicate fehlt.", responsibilities: ["Bild-Fallback"], code: ["lib/content/providers/openai-image.ts"], tests: ["tests/openai-image.test.cjs"], gaps: ["Kein Live-Nachweis"], env: ["OPENAI_API_KEY", "OPENAI_IMAGE_MODEL"] }),
  n({ id: "runway", label: "Runway (Video)", kind: "provider", cluster: "media", status: "live_verified",
    summary: "Stumme 10-Sekunden-Clips (gen4.5, Hochformat); Produkt-Pipeline produktiv, Themen-Pfad opt-in.", responsibilities: ["Videoerzeugung"], code: ["lib/runway.ts", "lib/visual/providers/runway-video.ts", "lib/production/runway-story.ts"],
    tests: ["tests/runway-story.test.cjs", "tests/production.test.cjs"], gaps: ["Themen-Pfad nicht live"], env: ["RUNWAYML_API_SECRET", "RUNWAY_MONTHLY_BUDGET_CREDITS", "TOPIC_STANDARD_VIDEO_PROVIDER"] }),
  n({ id: "heygen", label: "HeyGen (Avatar-Video)", kind: "provider", cluster: "media", status: "tested",
    summary: "Avatar-Videoproduktion hinter AvatarVideoProvider. Videoerzeugung, keine Veröffentlichung.", responsibilities: ["Avatar-Video", "lokales Monatslimit"], code: ["lib/visual/providers/heygen.ts"], tests: ["tests/avatar-video.test.cjs"],
    gaps: ["Account, Avatar, Stimme und Monatslimit fehlen", "Kein Live-Test"], env: ["HEYGEN_API_KEY", "HEYGEN_AVATAR_ID", "HEYGEN_VOICE_ID", "HEYGEN_MONTHLY_VIDEO_LIMIT"] }),
  n({ id: "faceless", label: "Faceless.so (Produkt-Pipeline)", kind: "provider", cluster: "media", status: "tested",
    summary: "Kostenpflichtige Videoproduktion der Produkt-Pipeline, nur nach gesonderter WhatsApp-Kostenfreigabe.", responsibilities: ["Video nach Kostenfreigabe"], code: ["lib/production/faceless-so.ts", "lib/production/request-cost-approval.ts"], tests: ["tests/production.test.cjs", "tests/production-route.test.cjs"], gaps: ["Live-Status in der Doku nicht ausgewiesen"] }),

  n({ id: "whatsapp", label: "WhatsApp-Webhook & Router", kind: "module", cluster: "approval", status: "live_verified",
    summary: "Einzige Freigabeinstanz. Signaturprüfung, Absenderprüfung, Intent-Klassifikation, Router.", responsibilities: ["Webhook (HMAC)", "Freigabe-Antworten", "Anweisungen/Sprachnachrichten"], code: ["app/api/whatsapp/webhook/route.ts", "lib/whatsapp/", "lib/whatsapp/security.ts"],
    tests: ["tests/whatsapp-router.test.cjs", "tests/whatsapp-instruction.test.cjs", "tests/publication-webhook.test.cjs"], gaps: [], env: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN", "META_APP_SECRET", "WHATSAPP_APPROVER_WA_ID"] }),
  n({ id: "content-approval", label: "Inhaltsfreigabe", kind: "guard", cluster: "approval", status: "live_verified",
    summary: "Betreiber gibt den Content-Plan frei; startet weder Produktion noch Veröffentlichung.", responsibilities: ["Freigabe/Änderungswunsch je Version"], code: ["lib/whatsapp/content-approval.ts", "app/api/content/jobs/"], tests: ["tests/content-approval.test.cjs"], gaps: [] }),
  n({ id: "production-gate", label: "Produktions-/Kostenfreigabe", kind: "guard", cluster: "approval", status: "tested",
    summary: "Kostenpflichtige Medienproduktion erst nach separater Freigabe.", responsibilities: ["Kostenfreigabe", "Budget"], code: ["lib/production/policy.ts", "lib/production/request-cost-approval.ts", "app/api/production/route.ts"], tests: ["tests/production.test.cjs", "tests/whatsapp-cost-continuation.test.cjs"], gaps: [] }),
  n({ id: "publish-gate", label: "Veröffentlichungs-Freigabeschranke", kind: "guard", cluster: "approval", status: "tested",
    summary: "Harte Invariante: Publish nur mit „Freigeben“ für exakt Content-ID, Version und Fingerprint; Einmal-Claim je Plattform; Re-Check vor dem irreversiblen Aufruf.",
    responsibilities: ["Fingerprint/Version", "Permit + assertPermitMatches", "Einmal-Claim", "Widerruf"], code: ["lib/publishing/approval-gate.ts", "lib/publishing/authority.ts", "lib/meta/publication-gate.ts"],
    tests: ["tests/publish-approval-gate.test.cjs", "tests/instagram-approval-recheck.test.cjs", "tests/runtime-guard.test.cjs"], gaps: ["Themen-Pfad nicht live geprüft"] }),

  n({ id: "publisher", label: "Multichannel-Publisher", kind: "module", cluster: "publishing", status: "tested",
    summary: "Ein Master Content, fünf Plattformadapter; jede Plattform isoliert, Dry-Run als Standard.", responsibilities: ["Varianten rendern", "publishAll mit Gate", "Status-Abgleich ohne Doppelpost"], code: ["lib/distribution/publish.ts", "lib/distribution/platforms/adapters.ts", "lib/distribution/master-content.ts", "lib/distribution/publishers/"],
    tests: ["tests/shared-distribution.test.cjs", "tests/platform-publishers.test.cjs", "tests/publish-report.test.cjs"], gaps: ["Kein Live-Aufruf des Themen-Pfads"], env: ["TOPIC_LIVE_PUBLISHING", "TOPIC_PLATFORMS"] }),
  n({ id: "instagram", label: "Instagram", kind: "platform", cluster: "publishing", status: "tested",
    summary: "Bild, Karussell, Reel über Graph API (Container → Freigabe-Re-Check → media_publish).", responsibilities: ["Publishing", "Statusabgleich"], code: ["lib/distribution/publishers/meta.ts", "lib/meta/instagram-publisher.ts", "lib/meta/instagram-reel.ts"],
    tests: ["tests/platform-publishers.test.cjs", "tests/instagram-reel.test.cjs", "tests/instagram-image.test.cjs", "tests/instagram-approval-recheck.test.cjs"], gaps: ["Themen-Pfad nicht live; Zugänge laut Doku nicht im Vercel-Projekt gelistet"], env: ["META_SYSTEM_USER_TOKEN", "META_PAGE_ID", "META_INSTAGRAM_USER_ID", "BLOB_READ_WRITE_TOKEN"] }),
  n({ id: "facebook", label: "Facebook", kind: "platform", cluster: "publishing", status: "tested",
    summary: "Text, Foto, Album, Video auf der Seite. Foto der Produkt-Pipeline laut Doku live; übrige Formate nicht.", responsibilities: ["Publishing"], code: ["lib/distribution/publishers/meta.ts", "lib/meta/facebook-page.ts"], tests: ["tests/platform-publishers.test.cjs", "tests/facebook-page-token.test.cjs", "tests/facebook-reconcile.test.cjs"],
    gaps: ["Text/Album/Video nicht live verifiziert"], env: ["META_SYSTEM_USER_TOKEN", "META_PAGE_ID"] }),
  n({ id: "tiktok", label: "TikTok", kind: "platform", cluster: "publishing", status: "tested",
    summary: "Content Posting API (Direct Post, PULL_FROM_URL), Standard SELF_ONLY.", responsibilities: ["Publishing", "Token-Erneuerung", "Statusabfrage"], code: ["lib/distribution/publishers/tiktok.ts"], tests: ["tests/platform-publishers.test.cjs"],
    gaps: ["Developer-App, video.publish-Scope, App-Audit, verifizierter URL-Präfix", "Zugangsdaten fehlen"], env: ["TIKTOK_ACCESS_TOKEN", "TIKTOK_REFRESH_TOKEN", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"] }),
  n({ id: "youtube", label: "YouTube Shorts", kind: "platform", cluster: "publishing", status: "tested",
    summary: "Data API v3 Resumable Upload; Standard private.", responsibilities: ["Publishing", "Statusabfrage"], code: ["lib/distribution/publishers/youtube.ts"], tests: ["tests/platform-publishers.test.cjs"],
    gaps: ["OAuth-Client + Refresh-Token (youtube.upload)", "Kontingent ≈1600 Einheiten je Upload", "Zugangsdaten fehlen"], env: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"] }),
  n({ id: "x", label: "X", kind: "platform", cluster: "publishing", status: "tested",
    summary: "API v2, OAuth 1.0a User Context, Bilder/Video-Upload dann ein Post.", responsibilities: ["Publishing"], code: ["lib/distribution/publishers/x.ts"], tests: ["tests/platform-publishers.test.cjs"],
    gaps: ["Projekt/App mit Schreibrecht (bezahlter Tarif für Posts)", "Zugangsdaten fehlen"], env: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"] }),

  n({ id: "vercel", label: "Vercel (Next.js, Functions)", kind: "infra", cluster: "infra", status: "live_verified", summary: "Produktionsplattform (Region fra1). Preview und Production teilen teils Ressourcen.", responsibilities: ["Hosting", "Functions"], code: ["vercel.json", "next.config.ts"], tests: [], gaps: ["Preview-Isolation nicht umgesetzt (docs/PREVIEW_ISOLATION.md)"] }),
  n({ id: "postgres", label: "Postgres", kind: "infra", cluster: "infra", status: "live_verified", summary: "Jobs, Freigaben, Historie, Lernen. Migrationen 001–034.", responsibilities: ["Persistenz"], code: ["lib/memory/", "db/migrations/"], tests: ["tests/memory.test.cjs", "tests/migration-upgrade.test.cjs"], gaps: ["Migration 034 nicht produktiv verifiziert"], env: ["DATABASE_URL"] }),
  n({ id: "blob", label: "Vercel Blob", kind: "infra", cluster: "infra", status: "live_verified", summary: "Ablage von Bildern, Grafiken, Videos; Schreibzugriffe über guarded-blob.", responsibilities: ["Medienablage"], code: ["lib/security/guarded-blob.ts"], tests: ["tests/runtime-guard.test.cjs"], gaps: [], env: ["BLOB_READ_WRITE_TOKEN"] }),
  n({ id: "cron", label: "Cron-System", kind: "infra", cluster: "infra", status: "live_verified", summary: "daily-draft (6×/Tag), weekly-report, continue; topic-scout bewusst nicht eingetragen.", responsibilities: ["Tageslauf", "Wochenbericht"], code: ["vercel.json", "app/api/cron/"], tests: ["tests/daily-cron-time.test.cjs", "tests/daily-automation.test.cjs", "tests/topic-cron.test.cjs"], gaps: [], env: ["CRON_SECRET"] }),
  n({ id: "api-auth", label: "API-Authentifizierung", kind: "guard", cluster: "infra", status: "tested", summary: "Zugangscode (x-content-password, timing-safe), Cron-Secret, WhatsApp-Signatur.", responsibilities: ["Operator-Routen schützen"], code: ["lib/memory/auth.ts"], tests: ["tests/api-access.test.cjs"], gaps: [], env: ["CONTENT_STUDIO_PASSWORD"] }),
  n({ id: "runtime-guard", label: "Runtime-Guard & Egress-Schutz", kind: "guard", cluster: "infra", status: "tested", summary: "Sperrt in Preview/Development DB, Publish, Nachrichten, Blob-Schreiben, bezahlte Provider und schreibende Aufrufe an Drittanbieter.", responsibilities: ["Preview-Schutz"], code: ["lib/security/runtime-guard.ts", "instrumentation.ts"], tests: ["tests/runtime-guard.test.cjs"], gaps: ["Live auf Vercel nicht getestet", "NON_PRODUCTION_SANDBOX bewusst ungesetzt"], env: ["NON_PRODUCTION_SANDBOX", "ALLOW_NON_PRODUCTION_PAID_CALLS"] }),
  n({ id: "observability", label: "Logging & Capabilities", kind: "module", cluster: "infra", status: "tested", summary: "Strukturierte Events ohne Secrets; Capability-Matrix meldet nur Variablennamen.", responsibilities: ["Events", "Status der Zugänge"], code: ["lib/observability/events.ts", "lib/capabilities/index.ts"], tests: ["tests/capabilities.test.cjs", "tests/whatsapp-status.test.cjs"], gaps: ["Kein Live-Aktivitätsfeed"] }),
  n({ id: "meta-api", label: "Meta Graph / WhatsApp Cloud API", kind: "external", cluster: "infra", status: "live_verified", summary: "Externe API für WhatsApp, Instagram und Facebook.", responsibilities: [], code: ["lib/meta/connection.ts", "lib/whatsapp/client.ts"], tests: ["tests/meta.test.cjs"], gaps: [] }),
  n({ id: "tavily", label: "Tavily", kind: "external", cluster: "research", status: "live_verified", summary: "Recherche-API (Produkt-Pipeline produktiv; News-Modus nicht).", responsibilities: [], code: ["lib/tavily.ts"], tests: ["tests/trend-agent.test.cjs"], gaps: [], env: ["TAVILY_API_KEY"] }),
];

export const EDGES: ArchEdge[] = [
  ...["trend-agent", "creative-agent", "video-agent", "image-agent", "text-agent", "marketing-agent"].map(id => ({ id: `o-jarvis-${id}`, from: "jarvis", to: id, kind: "orchestration" as const, label: "beauftragt" })),
  { id: "o-jarvis-router", from: "jarvis", to: "format-router", kind: "orchestration", label: "nutzt" },
  { id: "o-jarvis-vision", from: "jarvis", to: "vision-gate", kind: "orchestration", label: "prüft Bilder" },
  { id: "o-jarvis-scout", from: "jarvis", to: "product-scout", kind: "orchestration", label: "Recherche" },
  { id: "o-jarvis-reviewer", from: "jarvis", to: "product-reviewer", kind: "orchestration", label: "Produktprüfung" },
  { id: "o-jarvis-script", from: "jarvis", to: "script-writer", kind: "orchestration", label: "Referenzmodus" },
  { id: "o-jarvis-topic", from: "jarvis", to: "topic-orchestrator", kind: "orchestration", label: "Selektion/Historie" },
  { id: "o-jarvis-exec", from: "jarvis", to: "executive-agent", kind: "orchestration", label: "geplant" },
  { id: "o-topic-scout", from: "topic-orchestrator", to: "topic-scout", kind: "orchestration", label: "Themen" },
  { id: "o-topic-visual", from: "topic-orchestrator", to: "visual-engine", kind: "orchestration", label: "Medien" },
  { id: "o-topic-publisher", from: "topic-orchestrator", to: "publisher", kind: "orchestration", label: "Verteilung" },
  { id: "o-topic-router", from: "topic-orchestrator", to: "format-router", kind: "orchestration", label: "Formatwahl" },
  { id: "d-reviewer-affiliate", from: "product-reviewer", to: "affiliate-guard", kind: "data", label: "Produktidentität" },
  { id: "d-affiliate-publisher", from: "affiliate-guard", to: "publisher", kind: "data", label: "Link-Policy" },
  { id: "d-scout-tavily", from: "product-scout", to: "tavily", kind: "external", label: "Suche" },
  { id: "d-topic-scout-tavily", from: "topic-scout", to: "tavily", kind: "external", label: "News" },
  { id: "d-jarvis-pg", from: "jarvis", to: "postgres", kind: "data", label: "Jobs/Protokoll" },
  { id: "d-topic-pg", from: "topic-orchestrator", to: "postgres", kind: "data", label: "Läufe/Versionen" },
  { id: "d-visual-replicate", from: "visual-engine", to: "replicate", kind: "external", label: "Bilder" },
  { id: "d-visual-openai", from: "visual-engine", to: "openai-image", kind: "external", label: "Fallback" },
  { id: "d-visual-runway", from: "visual-engine", to: "runway", kind: "external", label: "Standard-Video" },
  { id: "d-visual-heygen", from: "visual-engine", to: "heygen", kind: "external", label: "Avatar-Video" },
  { id: "d-prod-faceless", from: "production-gate", to: "faceless", kind: "external", label: "nach Kostenfreigabe" },
  { id: "d-vision-replicate", from: "vision-gate", to: "replicate", kind: "external", label: "Bildprüfung" },
  { id: "d-visual-blob", from: "visual-engine", to: "blob", kind: "data", label: "Medien speichern" },
  { id: "a-jarvis-content", from: "jarvis", to: "content-approval", kind: "approval", label: "Plan zur Freigabe" },
  { id: "a-content-whatsapp", from: "content-approval", to: "whatsapp", kind: "approval", label: "Nachricht" },
  { id: "a-whatsapp-meta", from: "whatsapp", to: "meta-api", kind: "external", label: "Cloud API" },
  { id: "a-whatsapp-prod", from: "whatsapp", to: "production-gate", kind: "approval", label: "Kostenfreigabe" },
  { id: "a-whatsapp-publish", from: "whatsapp", to: "publish-gate", kind: "approval", label: "„Freigeben“" },
  { id: "p-gate-publisher", from: "publish-gate", to: "publisher", kind: "approval", label: "Permit" },
  ...["instagram", "facebook", "tiktok", "youtube", "x"].map(id => ({ id: `p-publisher-${id}`, from: "publisher", to: id, kind: "publishing" as const, label: "Adapter" })),
  { id: "p-ig-meta", from: "instagram", to: "meta-api", kind: "external", label: "Graph API" },
  { id: "p-fb-meta", from: "facebook", to: "meta-api", kind: "external", label: "Graph API" },
  { id: "i-vercel-cron", from: "vercel", to: "cron", kind: "orchestration", label: "löst aus" },
  { id: "i-cron-jarvis", from: "cron", to: "jarvis", kind: "orchestration", label: "Tageslauf" },
  { id: "i-cron-topic", from: "cron", to: "topic-orchestrator", kind: "orchestration", label: "nicht eingetragen" },
  { id: "i-vercel-jarvis", from: "vercel", to: "jarvis", kind: "orchestration", label: "hostet" },
  { id: "i-auth-jarvis", from: "api-auth", to: "jarvis", kind: "approval", label: "schützt Studio-API" },
  { id: "i-guard-publisher", from: "runtime-guard", to: "publisher", kind: "approval", label: "sperrt Preview" },
  { id: "i-guard-visual", from: "runtime-guard", to: "visual-engine", kind: "approval", label: "sperrt Bezahl-Provider (Preview)" },
  { id: "i-obs-jarvis", from: "observability", to: "jarvis", kind: "data", label: "Events" },
  { id: "i-vercel-pg", from: "vercel", to: "postgres", kind: "data", label: "DATABASE_URL" },
  { id: "i-vercel-blob", from: "vercel", to: "blob", kind: "data", label: "Blob-Token" },
];

export const ARCHITECTURE_META = {
  version: 1,
  basis: "Code- und Doku-Analyse des Repositories (Stand PR #63, d86dae1). Kein Laufzeitstatus.",
  liveActivity: "Nicht angebunden: Es werden keine Live-Aktivitäten dargestellt. Bewegungen in der Szene sind rein dekorativ.",
} as const;

export function nodeById(id: string) { return NODES.find(node => node.id === id); }
export function neighbours(id: string): string[] {
  return [...new Set(EDGES.flatMap(edge => edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : []))];
}
export function validateModel(nodes: ArchNode[] = NODES, edges: ArchEdge[] = EDGES): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const node of nodes) { if (ids.has(node.id)) problems.push(`duplicate node ${node.id}`); ids.add(node.id); }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) problems.push(`duplicate edge ${edge.id}`);
    edgeIds.add(edge.id);
    if (!ids.has(edge.from) || !ids.has(edge.to)) problems.push(`dangling edge ${edge.id}`);
  }
  return problems;
}
