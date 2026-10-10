// Architecture model of the Jarvis system for the Command Center.
//
// Static, hand-maintained inventory derived from the repository (code, tests, migrations, docs). It holds NO runtime data
// and NO secrets. Three status dimensions are kept apart:
//   implementation  – derived from code/tests listed here (planned | implemented | tested)
//   deployment      – where this code ships, from the repository state (main = production, this PR = preview)
//   operation       – computed at request time on the server (lib/architecture/runtime.ts) from configuration NAMES,
//                     feature flags and, where available, read-only database evidence. Never a guess.
// "Live verified" is not a status: a documented live proof is shown separately as `proof` with its source.

export type ImplementationStatus = "planned" | "implemented" | "tested";
export type DeploymentStatus = "not_deployed" | "preview" | "production";
export type OperationalStatus = "not_configured" | "disabled" | "ready" | "active" | "error" | "unknown" | "not_applicable";
export type ComponentKind = "orchestrator" | "agent" | "module" | "provider" | "platform" | "infra" | "guard" | "external";
export type ClusterId = "research" | "creative" | "quality" | "media" | "approval" | "publishing" | "infra";
export type EdgeKind = "orchestration" | "data" | "approval" | "publishing" | "external";

// How the operational status is determined (evaluated on the server, see runtime.ts).
export type OperationRule =
  | { type: "planned" }                                              // no code: no operation
  | { type: "code" }                                                 // pure code, no configuration of its own
  | { type: "flag"; flag: string; label: string }                    // feature flag must be exactly "true"
  | { type: "services"; ids: string[]; note?: string }               // capability check (lib/capabilities), names only
  | { type: "env"; anyOf: string[][]; note?: string }                // at least one complete group of variable NAMES
  | { type: "policy"; status: OperationalStatus; reason: string }    // documented decision, not measured
  | { type: "custom"; id: "trendsetter" | "vision" | "publisher" | "database" | "runway" };

export type ArchNode = {
  id: string;
  label: string;
  /** Short label for the 3D scene (≤ 22 characters). */
  short: string;
  kind: ComponentKind;
  /** "core" = Jarvis in the centre. */
  cluster: ClusterId | "core";
  /** One plain sentence for non-programmers. */
  plain: string;
  summary: string;
  responsibilities: string[];
  code: string[];
  tests: string[];
  gaps: string[];
  env?: string[];
  /** Which code line contains it: main (deployed to production) or this pull request only (preview). */
  since: "main" | "pr64" | "none";
  operation: OperationRule;
  /** Does it cause external effects (writes, messages, posts, paid calls)? Preview deployments block those. */
  effects: boolean;
  /** Documented live proof from the repository docs (not measured by the Command Center). */
  proof?: string;
};
export type ArchEdge = { id: string; from: string; to: string; kind: EdgeKind; label: string; planned?: boolean };

export const IMPLEMENTATION_META: Record<ImplementationStatus, { label: string; description: string }> = {
  planned: { label: "Geplant", description: "Im Code nicht vorhanden oder nur als Schnittstelle vorgesehen." },
  implemented: { label: "Implementiert", description: "Code vorhanden, ohne eigene automatisierte Tests." },
  tested: { label: "Getestet", description: "Code mit automatisierten Tests (Mocks/PGlite). Kein Live-Nachweis." },
};
export const DEPLOYMENT_META: Record<DeploymentStatus, { label: string; description: string }> = {
  not_deployed: { label: "Nicht deployt", description: "In keinem Deployment enthalten." },
  preview: { label: "Preview", description: "Nur im Pull Request #64 und dessen Vercel-Preview." },
  production: { label: "Production", description: "Im Hauptzweig main und damit im Production-Deployment." },
};
export const OPERATION_META: Record<OperationalStatus, { label: string; color: string; description: string }> = {
  ready: { label: "Bereit", color: "#3ddc84", description: "Konfiguration vollständig und eingeschaltet. Bereit heißt nicht, dass gerade etwas läuft." },
  active: { label: "Aktiv", color: "#4da3ff", description: "Arbeitet laut Datenbank gerade an einem Auftrag." },
  disabled: { label: "Deaktiviert", color: "#8a93a3", description: "Absichtlich ausgeschaltet (Schalter, Betreiberentscheidung oder Preview-Sperre)." },
  not_configured: { label: "Nicht konfiguriert", color: "#ffb020", description: "Es fehlen Zugangsdaten oder Einstellungen (nur Variablennamen geprüft)." },
  error: { label: "Fehler", color: "#ff5c5c", description: "Der letzte belegte Lauf ist fehlgeschlagen (Datenbank-Nachweis)." },
  unknown: { label: "Unbekannt", color: "#b48cff", description: "Nicht belegbar: Betriebsfähigkeit ist weder nachgewiesen noch widerlegt." },
  not_applicable: { label: "Kein Betrieb", color: "#5b6472", description: "Geplant – es gibt nichts, das laufen könnte." },
};
export const CLUSTER_META: Record<ClusterId, { label: string; short: string; color: string; plain: string; order: number }> = {
  research: { label: "Recherche & Themen", short: "Recherche", color: "#b48cff", plain: "Findet Trends, Themen und Produktchancen und bewertet sie.", order: 0 },
  creative: { label: "Kreativ & Content", short: "Kreativ", color: "#ff9ad5", plain: "Entwickelt Idee, Hook, Text, Drehbuch und wählt das Format.", order: 1 },
  quality: { label: "Qualität & Sicherheit", short: "Qualität", color: "#ffb86b", plain: "Prüft Bilder, Produktangaben, Links und sperrt Preview-Risiken.", order: 2 },
  media: { label: "Medienproduktion", short: "Medien", color: "#6bffb0", plain: "Erzeugt Bilder, Grafiken und Videos über externe Anbieter.", order: 3 },
  approval: { label: "WhatsApp & Freigaben", short: "Freigaben", color: "#ffe46b", plain: "Du entscheidest per WhatsApp: Inhalt, Kosten, Veröffentlichung.", order: 4 },
  publishing: { label: "Multichannel-Publishing", short: "Publishing", color: "#6bb5ff", plain: "Veröffentlicht freigegebene Inhalte auf den Plattformen.", order: 5 },
  infra: { label: "Infrastruktur", short: "Infrastruktur", color: "#a0a8b8", plain: "Hosting, Datenbank, Speicher, Zeitpläne und Protokolle.", order: 6 },
};
export const EDGE_META: Record<EdgeKind, { label: string; color: string }> = {
  orchestration: { label: "Steuerung", color: "#7cf5ff" },
  data: { label: "Daten", color: "#b48cff" },
  approval: { label: "Freigabe", color: "#ffe46b" },
  publishing: { label: "Veröffentlichung", color: "#6bb5ff" },
  external: { label: "Externe API", color: "#ff9ad5" },
};
export const KIND_LABEL: Record<ComponentKind, string> = {
  orchestrator: "Orchestrator", agent: "Spezialagent (nur über Jarvis)", module: "Internes Modul", provider: "Medien-/Modellanbieter",
  platform: "Veröffentlichungsplattform", infra: "Infrastruktur", guard: "Prüf-/Freigabeschranke", external: "Externer Dienst",
};

const n = (node: ArchNode): ArchNode => node;
const CODE: OperationRule = { type: "code" };
const TOPIC_FLAG: OperationRule = { type: "flag", flag: "TOPIC_PIPELINE_ENABLED", label: "Themen-Pipeline" };

export const NODES: ArchNode[] = [
  n({ id: "jarvis", label: "Jarvis (Content-Orchestrator)", short: "JARVIS", kind: "orchestrator", cluster: "core", since: "main", effects: true,
    plain: "Die Zentrale: entscheidet, welche Chance in welche Pipeline geht, beauftragt die Agenten und prüft ihre Ergebnisse.",
    summary: "Einziger Ort, der Spezialagenten beauftragt. Entscheidet über Content-Chancen des Trendsetters, gewichtet Ideen, wählt das Format und übergibt zur Freigabe. Startet nie selbst Produktion oder Veröffentlichung.",
    responsibilities: ["Content-Chancen routen: Affiliate, Thema, beides oder zurückhalten (lib/trendsetter/routing.ts)", "Themen-Prüfung vor jedem Vorschlag (lib/topics/gate.ts)", "Entwürfe validieren, max. 2 automatische Revisionen, max. 8 Modellaufrufe", "Übergabe zur Inhaltsfreigabe"],
    code: ["lib/orchestrator.ts", "lib/content/orchestrator.ts", "lib/trendsetter/routing.ts", "lib/topics/gate.ts"], tests: ["tests/content.test.cjs", "tests/trendsetter.test.cjs", "tests/pipeline-recovery.test.cjs"],
    gaps: ["KI-Modus der Agenten nicht live belegt; Referenzmodus ist regelbasiert"], operation: CODE }),

  // ---- Recherche & Themen ----
  n({ id: "trendsetter", label: "Trendsetter (gemeinsame Content-Chancen)", short: "Trendsetter", kind: "module", cluster: "research", since: "pr64", effects: false,
    plain: "Sammelt alle gefundenen Trends und Themen an einer Stelle, bewertet sie einheitlich und verhindert Doppelungen.",
    summary: "Führt Trend-Recherche (Affiliate) und Themen-Quellen (Themen-Pipeline) zu einheitlichen Content-Chancen zusammen: ID, Quellen, Zeitstempel, fünf Bewertungen, Empfehlung für eine oder beide Pipelines. Recherchiert nicht selbst.",
    responsibilities: ["Content-Chance mit eindeutiger ID je Konzept", "Bewertung: Aktualität, Relevanz, Zielgruppeninteresse, Vertrauen, Reichweite", "Gemeinsame Rechercheergebnisse (content_chances)", "Duplikatkontrolle und Zeitsperren je Pipeline (content_chance_routes)"],
    code: ["lib/trendsetter/chance.ts", "lib/trendsetter/repository.ts", "lib/trendsetter/topic.ts", "lib/trendsetter/affiliate.ts", "db/migrations/035_content_chances.sql"], tests: ["tests/trendsetter.test.cjs"],
    gaps: ["Affiliate-Anbindung standardmäßig aus (TRENDSETTER_AFFILIATE=record|route schaltet sie ein)", "Migration 035 noch nicht in Produktion"], env: ["TRENDSETTER_AFFILIATE", "TOPIC_PIPELINE_ENABLED"],
    operation: { type: "custom", id: "trendsetter" } }),
  n({ id: "trend-agent", label: "Trend-Recherche (Trend-Agent)", short: "Trend-Recherche", kind: "agent", cluster: "research", since: "main", effects: true,
    plain: "Recherchiert per Tavily aktuelle Ideen und lässt sie von einem Sprachmodell als Produkt- oder Themenchance einordnen.",
    summary: "Spezialagent: Tavily-Recherche + ein begrenzter Modellaufruf → strukturierte Chancen mit Belegen. Ohne Modell fällt die Affiliate-Pipeline auf Seed-Ideen zurück.",
    responsibilities: ["Recherche in vier Richtungen", "Produkt- und Themenchancen mit Belegen", "Unbelegte Preis-/Testaussagen verwerfen"], code: ["lib/content/trend-scout.ts", "lib/content/agents/trend.ts", "lib/content/trend.ts"],
    tests: ["tests/trend-agent.test.cjs"], gaps: ["Live-Lauf mit Modell und Tavily nicht belegt"], env: ["REPLICATE_API_TOKEN", "TAVILY_API_KEY"],
    operation: { type: "services", ids: ["replicate", "tavily"], note: "Ohne Modell: Seed-Ideen statt Recherche" } }),
  n({ id: "topic-scout", label: "Themen-Quellen (Themen-Scout)", short: "Themen-Quellen", kind: "module", cluster: "research", since: "main", effects: true,
    plain: "Liest Nachrichten, Suchtrends, Wikipedia und den Kalender und bildet daraus bewertete Themen.",
    summary: "Findet, bündelt und bewertet Themen aus Google News/Trends, Wikipedia, Tavily, Kalender und Evergreens. Regelbasierte Bewertung, keine Erfindungen.",
    responsibilities: ["Signale sammeln und bündeln", "Bewertung und Verlauf/Wiederholungen"], code: ["lib/topics/scout.ts", "lib/topics/discovery.ts", "lib/topics/scoring.ts", "lib/topics/sources/"],
    tests: ["tests/topic-scout.test.cjs"], gaps: ["Quellen-Feeds live nicht geprüft"], env: ["TOPIC_SOURCE_GOOGLE_NEWS", "TOPIC_SOURCE_GOOGLE_TRENDS", "TOPIC_SOURCE_WIKIPEDIA", "TAVILY_API_KEY"],
    operation: TOPIC_FLAG }),
  n({ id: "topic-orchestrator", label: "Themen-Pipeline (Ablaufsteuerung)", short: "Themen-Pipeline", kind: "orchestrator", cluster: "research", since: "main", effects: true,
    plain: "Führt einen Themenbeitrag Schritt für Schritt durch Vorschlag, Produktion, Freigaben und Veröffentlichung.",
    summary: "Ablaufsteuerung der Themenbeiträge. Jarvis entscheidet, welche Chance zum Thema wird; diese Steuerung führt sie danach durch Vorschlag → Produktionsfreigabe → Produktion → Veröffentlichungsfreigabe → Verteilung.",
    responsibilities: ["Themenvorschlag per WhatsApp", "Zwei getrennte Freigaben", "Tageslimit (TOPIC_POSTS_PER_DAY, Standard 1)", "Wiederaufnahme laufender Videojobs"],
    code: ["lib/topic-pipeline/orchestrator.ts", "lib/topic-pipeline/cron.ts", "app/api/cron/topic-scout/route.ts"], tests: ["tests/topic-pipeline.test.cjs", "tests/dry-run-e2e.test.cjs", "tests/topic-cron.test.cjs", "tests/topic-daily-limit.test.cjs"],
    gaps: ["TOPIC_PIPELINE_ENABLED nicht gesetzt (bewusst)", "Cron /api/cron/topic-scout nicht in vercel.json", "Preview-Isolation vorher umsetzen"], env: ["TOPIC_PIPELINE_ENABLED", "TOPIC_LIVE_PUBLISHING", "TOPIC_PLATFORMS", "TOPIC_POSTS_PER_DAY"],
    operation: TOPIC_FLAG }),
  n({ id: "product-scout", label: "Produkt-Scout", short: "Produkt-Scout", kind: "module", cluster: "research", since: "main", effects: true,
    plain: "Sucht zu einer bestätigten Content-Chance ein passendes Amazon-Produkt.",
    summary: "Spezialisierte Komponente der Affiliate-Pipeline: Seeds und gezielte Produktsuche; mit TRENDSETTER_AFFILIATE=route nur für Chancen, die Jarvis der Affiliate-Pipeline zuweist.",
    responsibilities: ["Produktsuche zu einer Chance", "Höchstens fünf Amazon-Abfragen je Lauf"], code: ["lib/agents/product-scout.ts", "lib/agents/content-chances.ts"],
    tests: ["tests/daily-automation.test.cjs"], gaps: [], env: ["TAVILY_API_KEY"], operation: CODE, proof: "docs/CREDENTIALS.md: Produkt-Pipeline produktiv genutzt" }),
  n({ id: "product-reviewer", label: "Produkt-Prüfung", short: "Produkt-Prüfung", kind: "module", cluster: "research", since: "main", effects: false,
    plain: "Prüft, ob das gefundene Produkt wirklich das gemeinte ist (ASIN, Quellen).",
    summary: "Prüft Kandidaten gegen Quellen und Amazon-Produktdaten; Quellen sind kein Nachweis einzelner Eigenschaften.",
    responsibilities: ["Produktidentität (ASIN)", "Quellenrecherche"], code: ["lib/agents/product-reviewer.ts", "lib/product-resolver.ts", "lib/amazon.ts"],
    tests: ["tests/product-contract.test.cjs", "tests/affiliate-guard.test.cjs"], gaps: [], operation: CODE }),
  n({ id: "tavily", label: "Tavily (Recherche-API)", short: "Tavily", kind: "external", cluster: "research", since: "main", effects: true,
    plain: "Externer Suchdienst, den Trend-Recherche und Themen-Quellen nutzen.", summary: "Recherche-API; wird von beiden Recherchewegen genutzt, keine eigene Logik.",
    responsibilities: [], code: ["lib/tavily.ts"], tests: ["tests/trend-agent.test.cjs"], gaps: [], env: ["TAVILY_API_KEY"],
    operation: { type: "services", ids: ["tavily"] }, proof: "docs/CREDENTIALS.md: Produkt-Pipeline live genutzt; News-Modus nicht" }),

  // ---- Kreativ & Content ----
  n({ id: "creative-agent", label: "Creative-Agent", short: "Creative-Agent", kind: "agent", cluster: "creative", since: "main", effects: false,
    plain: "Entwickelt die eigentliche Idee: Alltagssituation, Hook, Nutzen und Call-to-Action.",
    summary: "Drei Ideen (Video, Bild, Text) mit Alltagssituation, Story, Nutzen und Voraussetzungen. Keine erfundenen Fakten.",
    responsibilities: ["Hook und Idee", "Nutzwert", "Call-to-Action"], code: ["lib/content/agents/creative.ts", "lib/content/creative-quality.ts"],
    tests: ["tests/creative-quality.test.cjs", "tests/content.test.cjs"], gaps: ["Referenzmodus: Vorlagen/Regeln; KI-Modus nicht live belegt"], operation: CODE }),
  n({ id: "format-router", label: "Format-Router", short: "Format-Router", kind: "module", cluster: "creative", since: "main", effects: false,
    plain: "Wählt das passende Format: Text, Bild, Karussell, Video oder Avatar-Video – nach Nutzen, Plattform und Kosten.",
    summary: "Regelbasierte Formatwahl mit dokumentierten Gewichten; nur tatsächlich verfügbare Anbieter; Text braucht keinen Anbieter.",
    responsibilities: ["Formatentscheidung", "Betreiber-Wünsche haben Vorrang"], code: ["lib/formats/router.ts", "lib/formats/catalog.ts", "lib/formats/override.ts"],
    tests: ["tests/format-router.test.cjs"], gaps: [], operation: CODE }),
  n({ id: "video-agent", label: "Video-Agent", short: "Video-Agent", kind: "agent", cluster: "creative", since: "main", effects: false,
    plain: "Schreibt das Drehbuch für 10–40-Sekunden-Videos.", summary: "Drehbücher mit Szenen, Audio und Overlay.",
    responsibilities: ["Drehbuch"], code: ["lib/content/agents/video.ts"], tests: ["tests/content.test.cjs", "tests/video-revision.test.cjs"], gaps: [], operation: CODE }),
  n({ id: "image-agent", label: "Bild-Agent", short: "Bild-Agent", kind: "agent", cluster: "creative", since: "main", effects: false,
    plain: "Beschreibt, wie das Bild aussehen soll (Briefing, Alt-Text).", summary: "Layouts, Prompts und Alt-Texte für Einzelbild und Karussell.",
    responsibilities: ["Bildbriefing"], code: ["lib/content/agents/image.ts", "lib/content/image-brief.ts"], tests: ["tests/content.test.cjs", "tests/image-quality.test.cjs"], gaps: [], operation: CODE }),
  n({ id: "text-agent", label: "Text-Agent", short: "Text-Agent", kind: "agent", cluster: "creative", since: "main", effects: false,
    plain: "Schreibt die Beitragstexte.", summary: "Textpost-Entwürfe.", responsibilities: ["Textentwurf"], code: ["lib/content/agents/text.ts", "lib/content/editorial-copy.ts"],
    tests: ["tests/content.test.cjs"], gaps: [], operation: CODE }),
  n({ id: "marketing-agent", label: "Marketing-Agent", short: "Marketing-Agent", kind: "agent", cluster: "creative", since: "main", effects: false,
    plain: "Schlägt Plattform, Linkplatzierung und Messgrößen vor – veröffentlicht selbst nichts.", summary: "Plattformempfehlung, Link-/CTA-Platzierung.",
    responsibilities: ["Plattformempfehlung"], code: ["lib/content/agents/marketing.ts"], tests: ["tests/content.test.cjs"], gaps: [], operation: CODE }),
  n({ id: "script-writer", label: "Drehbuch-Regelwerk", short: "Drehbuch-Regeln", kind: "module", cluster: "creative", since: "main", effects: false,
    plain: "Kuratierte Drehbuch-Vorlagen für bekannte Produktfamilien.", summary: "Regel-/vorlagenbasierter Drehbuch-Endpunkt.",
    responsibilities: ["Vorlagen"], code: ["lib/agents/script-writer.ts", "docs/SCRIPT_WRITER_MANIFEST.md"], tests: ["tests/content.test.cjs"], gaps: [], operation: CODE }),

  // ---- Qualität & Sicherheit ----
  n({ id: "vision-gate", label: "Bild-Qualitätsprüfung", short: "Bildprüfung", kind: "guard", cluster: "quality", since: "main", effects: true,
    plain: "Schaut sich jedes erzeugte Bild an und lässt nur passende Bilder zur Freigabe durch.",
    summary: "Prüft das tatsächlich erzeugte Bild gegen das Briefing: falsches Hauptmotiv, unpassende Objekte, falsches Produkt, Bildfehler, Schrift/Logos, unrealistische Darstellung, Format 4:5. Unsicher = nie freigegeben. Höchstens 2 Bildversuche je Auftrag, Tageslimit 12.",
    responsibilities: ["Visuelles Quality Gate", "Fehlercodes für gezielte Korrektur", "Budget und Lernen"], code: ["lib/content/image-quality/gate.ts", "lib/content/image-quality/production.ts", "lib/content/image-quality/feedback.ts", "db/migrations/034_image_quality.sql"],
    tests: ["tests/image-quality.test.cjs", "tests/fallback-chain.test.cjs"], gaps: ["Bildfähigkeit des Vision-Modells nicht live belegt (scripts/vision-smoke-test.cjs Stufe 2, kostenpflichtig)", "Migration 034 in Produktion nicht verifiziert"],
    env: ["IMAGE_QUALITY_MODEL", "IMAGE_QUALITY_GATE", "REPLICATE_API_TOKEN"], operation: { type: "custom", id: "vision" } }),
  n({ id: "affiliate-guard", label: "Produkt- & Linkregeln", short: "Link-Regeln", kind: "guard", cluster: "quality", since: "main", effects: false,
    plain: "Sorgt dafür, dass Produkt, Aussagen und Affiliate-Links zusammenpassen.", summary: "Produktidentität, Claim-Unterstützung, Link-Regeln je Plattform. Affiliate-Links werden nie aufgerufen.",
    responsibilities: ["ASIN-Bindung", "Link-Policy"], code: ["lib/affiliate-guard.ts", "lib/content/product-contract.ts", "lib/distribution/link-policy.ts"],
    tests: ["tests/affiliate-guard.test.cjs", "tests/product-contract.test.cjs"], gaps: [], operation: CODE }),
  n({ id: "runtime-guard", label: "Preview-Schutz (Runtime-Guard)", short: "Preview-Schutz", kind: "guard", cluster: "quality", since: "main", effects: false,
    plain: "Verhindert, dass Test-Deployments echte Daten schreiben, Nachrichten senden oder veröffentlichen.",
    summary: "Sperrt in Preview/Development: Datenbank, Veröffentlichung, Nachrichten, Blob-Schreiben, bezahlte Anbieter, schreibende Drittanbieter-Aufrufe. Unbekannte Vercel-Umgebung gilt als Preview (fail-closed).",
    responsibilities: ["Preview-Sperre", "Egress-Filter"], code: ["lib/security/runtime-guard.ts", "instrumentation.ts"], tests: ["tests/runtime-guard.test.cjs"],
    gaps: ["Auf Vercel nicht live getestet", "Neon und Blob werden von Preview und Production geteilt (docs/PREVIEW_ISOLATION_MATRIX.md)"], env: ["NON_PRODUCTION_SANDBOX", "ALLOW_NON_PRODUCTION_PAID_CALLS"], operation: CODE }),
  n({ id: "api-auth", label: "Zugangsschutz", short: "Zugangsschutz", kind: "guard", cluster: "quality", since: "main", effects: false,
    plain: "Nur mit Zugangscode, Cron-Secret oder gültiger WhatsApp-Signatur kommt man an die Funktionen.",
    summary: "Zugangscode (timing-safe), Cron-Secret, WhatsApp-Signatur.", responsibilities: ["Operator-Routen schützen"], code: ["lib/memory/auth.ts"], tests: ["tests/api-access.test.cjs"],
    gaps: [], env: ["CONTENT_STUDIO_PASSWORD"], operation: { type: "env", anyOf: [["CONTENT_STUDIO_PASSWORD"]] } }),

  // ---- Medienproduktion ----
  n({ id: "visual-engine", label: "Visual Engine", short: "Visual Engine", kind: "module", cluster: "media", since: "main", effects: true,
    plain: "Erzeugt für Themenbeiträge Bilder, Textgrafiken, Karussells und Videos – mit Ausweichweg, wenn ein Anbieter ausfällt.",
    summary: "Anbieterwahl, Auftragsbuch (keine Doppelbestellung), Budget, Fallback-Kette.", responsibilities: ["Anbieterwahl", "Fallbacks"],
    code: ["lib/visual/engine.ts", "lib/visual/ledger.ts", "lib/visual/video.ts"], tests: ["tests/visual-engine.test.cjs", "tests/fallback-chain.test.cjs"], gaps: ["Themen-Bilder nicht live geprüft"], operation: TOPIC_FLAG }),
  n({ id: "replicate", label: "Replicate (Bilder, Sprachmodell)", short: "Replicate", kind: "provider", cluster: "media", since: "main", effects: true,
    plain: "Externer Anbieter für Bilder (FLUX) und das Sprachmodell des WhatsApp-Routers.", summary: "Bildgenerierung und semantischer Router.",
    responsibilities: ["Bilder", "Sprachverständnis"], code: ["lib/content/providers/replicate-image.ts", "lib/visual/providers/replicate.ts", "lib/whatsapp/route-llm.ts"],
    tests: ["tests/replicate-image.test.cjs", "tests/whatsapp-router.test.cjs"], gaps: ["Drosselung (429) beachten"], env: ["REPLICATE_API_TOKEN", "REPLICATE_IMAGE_MODEL"],
    operation: { type: "services", ids: ["replicate"] }, proof: "docs/CREDENTIALS.md: Router und Produktbilder produktiv; Themen-Bilder nicht" }),
  n({ id: "openai-image", label: "OpenAI-Bild (Ausweich)", short: "OpenAI-Bild", kind: "provider", cluster: "media", since: "main", effects: true,
    plain: "Nur Notlösung der Produkt-Pipeline, wenn Replicate fehlt.", summary: "Bild-Fallback der Produkt-Pipeline; die Themen-Pipeline nutzt ihn nicht.",
    responsibilities: ["Bild-Fallback"], code: ["lib/content/providers/openai-image.ts"], tests: ["tests/openai-image.test.cjs"], gaps: ["Kein Live-Nachweis"], env: ["OPENAI_API_KEY"],
    operation: { type: "services", ids: ["openai"], note: "Nur Ausweichweg" } }),
  n({ id: "runway", label: "Runway (Video)", short: "Runway", kind: "provider", cluster: "media", since: "main", effects: true,
    plain: "Externer Anbieter für kurze KI-Videos.", summary: "Stumme 10-Sekunden-Clips im Hochformat; Produkt-Pipeline nach Kostenfreigabe, Themen-Pfad nur mit TOPIC_STANDARD_VIDEO_PROVIDER=runway.",
    responsibilities: ["Videoerzeugung"], code: ["lib/runway.ts", "lib/visual/providers/runway-video.ts", "lib/production/runway-story.ts"], tests: ["tests/runway-story.test.cjs", "tests/production.test.cjs"],
    gaps: ["Themen-Pfad nicht live"], env: ["RUNWAYML_API_SECRET", "RUNWAY_MONTHLY_BUDGET_CREDITS", "TOPIC_STANDARD_VIDEO_PROVIDER"], operation: { type: "custom", id: "runway" },
    proof: "docs/CREDENTIALS.md: Produkt-Pipeline live genutzt" }),
  n({ id: "heygen", label: "HeyGen (Avatar-Video)", short: "HeyGen", kind: "provider", cluster: "media", since: "main", effects: true,
    plain: "Externer Anbieter für Erklärvideos mit Avatar.", summary: "Avatar-Videos hinter der AvatarVideoProvider-Schnittstelle, mit lokalem Monatslimit.",
    responsibilities: ["Avatar-Video"], code: ["lib/visual/providers/heygen.ts"], tests: ["tests/avatar-video.test.cjs"], gaps: ["Account, Avatar, Stimme und Monatslimit fehlen", "Kein Live-Test"],
    env: ["HEYGEN_API_KEY", "HEYGEN_AVATAR_ID", "HEYGEN_VOICE_ID", "HEYGEN_MONTHLY_VIDEO_LIMIT"], operation: { type: "services", ids: ["heygen"] } }),
  n({ id: "faceless", label: "Faceless.so (Altpfad)", short: "Faceless.so", kind: "provider", cluster: "media", since: "main", effects: true,
    plain: "Früher genutzter Videoanbieter. Laut deiner Vorgabe kein aktiver Produktionsanbieter.",
    summary: "Kostenpflichtige Videoproduktion der Produkt-Pipeline nach gesonderter Kostenfreigabe. Nicht Teil der Themen-Pipeline. Die manuelle Auswahl im Produkt-Studio besteht technisch noch.",
    responsibilities: ["Video nach Kostenfreigabe (Altpfad)"], code: ["lib/production/faceless-so.ts", "lib/production/request-cost-approval.ts"], tests: ["tests/production.test.cjs", "tests/production-route.test.cjs"],
    gaps: ["Auswahlpunkt im Produkt-Studio entfernen? (Entscheidung offen)"], env: ["FACELESS_API_KEY"],
    operation: { type: "policy", status: "disabled", reason: "Betreiberentscheidung: nicht als aktiver Produktionsanbieter einsetzen. Technisch im Produkt-Studio noch manuell wählbar." } }),

  // ---- WhatsApp & Freigaben ----
  n({ id: "whatsapp", label: "WhatsApp-Router", short: "WhatsApp", kind: "module", cluster: "approval", since: "main", effects: true,
    plain: "Dein Kanal zu Jarvis: Vorschläge, Rückfragen, Freigaben und Statusmeldungen – auch in freier Sprache und per Sprachnachricht.",
    summary: "Einzige Freigabeinstanz. Signatur- und Absenderprüfung, deterministische Befehle, semantischer Router für freie Sprache, eindeutige Zuordnung über die zitierte Nachricht.",
    responsibilities: ["Webhook (HMAC)", "Freigabe-Antworten", "Freie Sprache und Sprachnachrichten", "Status mit Links"], code: ["app/api/whatsapp/webhook/route.ts", "lib/whatsapp/router.ts", "lib/whatsapp/topic-route.ts", "lib/whatsapp/security.ts"],
    tests: ["tests/whatsapp-router.test.cjs", "tests/whatsapp-instruction.test.cjs", "tests/topic-route.test.cjs"], gaps: [],
    env: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_VERIFY_TOKEN", "META_APP_SECRET", "WHATSAPP_APPROVER_WA_ID"],
    operation: { type: "services", ids: ["whatsapp"] }, proof: "docs/CREDENTIALS.md: Freigaben produktiv genutzt" }),
  n({ id: "content-approval", label: "Inhaltsfreigabe", short: "Inhaltsfreigabe", kind: "guard", cluster: "approval", since: "main", effects: true,
    plain: "Stufe 1: Du gibst den Inhalt frei. Das startet weder Produktion noch Veröffentlichung.", summary: "Freigabe bzw. Änderungswunsch je Version.",
    responsibilities: ["Freigabe/Änderung je Version"], code: ["lib/whatsapp/content-approval.ts", "app/api/content/jobs/"], tests: ["tests/content-approval.test.cjs"], gaps: [],
    operation: { type: "services", ids: ["whatsapp", "database"] }, proof: "docs/CREDENTIALS.md: Produkt-Pipeline produktiv" }),
  n({ id: "production-gate", label: "Kostenfreigabe", short: "Kostenfreigabe", kind: "guard", cluster: "approval", since: "main", effects: true,
    plain: "Stufe 2: Kostenpflichtige Produktion startet erst nach deiner ausdrücklichen Kostenfreigabe.", summary: "Kostenfreigabe und Budget vor jeder bezahlten Produktion.",
    responsibilities: ["Kostenfreigabe", "Budget"], code: ["lib/production/policy.ts", "lib/production/request-cost-approval.ts", "app/api/production/route.ts"],
    tests: ["tests/production.test.cjs", "tests/whatsapp-cost-continuation.test.cjs"], gaps: [], operation: { type: "services", ids: ["whatsapp", "database"] } }),
  n({ id: "publish-gate", label: "Veröffentlichungsfreigabe", short: "Veröff.-Freigabe", kind: "guard", cluster: "approval", since: "main", effects: true,
    plain: "Stufe 4: Veröffentlicht wird nur genau die Fassung, die du mit „Freigeben“ bestätigt hast – jede Änderung braucht eine neue Freigabe.",
    summary: "Harte Invariante: Content-ID, Version und Fingerprint; Einmal-Claim je Plattform; erneute Prüfung direkt vor dem irreversiblen Aufruf.",
    responsibilities: ["Fingerprint/Version", "Einmal-Claim", "Widerruf bei Änderung"], code: ["lib/publishing/approval-gate.ts", "lib/publishing/authority.ts", "lib/meta/publication-gate.ts"],
    tests: ["tests/publish-approval-gate.test.cjs", "tests/instagram-approval-recheck.test.cjs", "tests/runtime-guard.test.cjs"], gaps: ["Themen-Pfad nicht live geprüft"],
    operation: { type: "services", ids: ["database"] } }),
  n({ id: "executive-agent", label: "Executive-Agent", short: "Executive-Agent", kind: "agent", cluster: "approval", since: "none", effects: false,
    plain: "Geplant, nicht gebaut. Freigaben erteilst ausschließlich du.", summary: "Nur als Schnittstelle vorgesehen (ApprovalAuthorityKind). Darf ohne geprüfte Codeänderung nichts freigeben. Kein Bestandteil des Go-live.",
    responsibilities: ["Spätere Freigabeinstanz"], code: ["lib/publishing/authority.ts"], tests: [], gaps: ["Kein Agentencode vorhanden"], operation: { type: "planned" } }),

  // ---- Multichannel-Publishing ----
  n({ id: "publisher", label: "Multichannel-Publisher", short: "Publisher", kind: "module", cluster: "publishing", since: "main", effects: true,
    plain: "Verteilt einen freigegebenen Inhalt auf die Plattformen – jede Plattform einzeln, ohne Doppelposts.",
    summary: "Ein Master Content, Plattformadapter; jede Plattform isoliert; Dry-Run als Standard; Ergebnis und Link je Plattform gespeichert; „Wiederholen“ nur für fehlgeschlagene Plattformen.",
    responsibilities: ["Varianten je Plattform", "Veröffentlichung mit Freigabe-Prüfung", "Statusabgleich ohne Doppelpost"], code: ["lib/distribution/publish.ts", "lib/distribution/platforms/adapters.ts", "lib/distribution/publishers/", "lib/publishing/report.ts"],
    tests: ["tests/shared-distribution.test.cjs", "tests/platform-publishers.test.cjs", "tests/publish-report.test.cjs"], gaps: ["Kein Live-Aufruf des Themen-Pfads"], env: ["TOPIC_LIVE_PUBLISHING", "TOPIC_PLATFORMS"],
    operation: { type: "custom", id: "publisher" } }),
  n({ id: "instagram", label: "Instagram", short: "Instagram", kind: "platform", cluster: "publishing", since: "main", effects: true,
    plain: "Bild, Karussell und Reel über die Instagram Graph API.", summary: "Container → erneute Freigabeprüfung → media_publish. Produkt-Pipeline nutzt den bestehenden Meta-Weg.",
    responsibilities: ["Veröffentlichung", "Statusabgleich"], code: ["lib/distribution/publishers/meta.ts", "lib/meta/instagram-publisher.ts", "lib/meta/instagram-reel.ts"],
    tests: ["tests/platform-publishers.test.cjs", "tests/instagram-reel.test.cjs", "tests/instagram-approval-recheck.test.cjs"], gaps: ["META_PAGE_ID, META_INSTAGRAM_USER_ID nicht gesetzt"],
    env: ["META_SYSTEM_USER_TOKEN", "META_PAGE_ID", "META_INSTAGRAM_USER_ID", "BLOB_READ_WRITE_TOKEN"], operation: { type: "services", ids: ["instagram"] } }),
  n({ id: "facebook", label: "Facebook", short: "Facebook", kind: "platform", cluster: "publishing", since: "main", effects: true,
    plain: "Text, Foto, Album und Video auf der Facebook-Seite.", summary: "Foto der Produkt-Pipeline laut Doku live; übrige Formate nicht live verifiziert.",
    responsibilities: ["Veröffentlichung"], code: ["lib/distribution/publishers/meta.ts", "lib/meta/facebook-page.ts"], tests: ["tests/platform-publishers.test.cjs", "tests/facebook-page-token.test.cjs"],
    gaps: ["Text/Album/Video nicht live verifiziert", "META_PAGE_ID nicht gesetzt (Themen-Pfad)"], env: ["META_SYSTEM_USER_TOKEN", "META_PAGE_ID"], operation: { type: "services", ids: ["facebook"] },
    proof: "docs/CREDENTIALS.md: Foto-Posts der Produkt-Pipeline live" }),
  n({ id: "tiktok", label: "TikTok", short: "TikTok", kind: "platform", cluster: "publishing", since: "main", effects: true,
    plain: "Videos über die TikTok Content Posting API (zunächst nur privat).", summary: "Direct Post (PULL_FROM_URL), Standard SELF_ONLY bis zum App-Audit.",
    responsibilities: ["Veröffentlichung", "Token-Erneuerung"], code: ["lib/distribution/publishers/tiktok.ts"], tests: ["tests/platform-publishers.test.cjs"],
    gaps: ["Developer-App, video.publish, App-Audit, verifizierter URL-Präfix", "Zugangsdaten fehlen"], env: ["TIKTOK_ACCESS_TOKEN", "TIKTOK_REFRESH_TOKEN", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    operation: { type: "services", ids: ["tiktok"] } }),
  n({ id: "youtube", label: "YouTube Shorts", short: "YouTube Shorts", kind: "platform", cluster: "publishing", since: "main", effects: true,
    plain: "Kurzvideos über die YouTube Data API (Standard: privat).", summary: "Resumable Upload; Refresh-Token-Ablauf; Statusabfrage über videos.list.",
    responsibilities: ["Veröffentlichung", "Statusabfrage"], code: ["lib/distribution/publishers/youtube.ts"], tests: ["tests/platform-publishers.test.cjs"],
    gaps: ["OAuth-Zustimmungsseite im Testmodus: Refresh-Token läuft nach 7 Tagen ab", "Öffentliche Uploads erst nach API-Audit", "Kontingent ≈1600 Einheiten je Upload"],
    env: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"], operation: { type: "services", ids: ["youtube"] } }),
  n({ id: "x", label: "X", short: "X", kind: "platform", cluster: "publishing", since: "main", effects: true,
    plain: "Posts mit Bild oder Video über die X API (kostenpflichtiger Tarif nötig).", summary: "API v2, OAuth 1.0a, Medien-Upload, ein Post.",
    responsibilities: ["Veröffentlichung"], code: ["lib/distribution/publishers/x.ts"], tests: ["tests/platform-publishers.test.cjs"], gaps: ["App mit Schreibrecht (bezahlter Tarif)", "Zugangsdaten fehlen"],
    env: ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_TOKEN_SECRET"], operation: { type: "services", ids: ["x"] } }),
  n({ id: "pinterest", label: "Pinterest", short: "Pinterest", kind: "platform", cluster: "publishing", since: "none", effects: false,
    plain: "Begonnen: Die Developer-App wird eingerichtet. Im Code gibt es noch keine Anbindung.",
    summary: "Vorbereitung: öffentliche Datenschutz-URL (/datenschutz) ist live. Es fehlen App-Freigabe, OAuth, Board-Berechtigungen und der Publisher-Code.",
    responsibilities: ["Pins veröffentlichen (geplant)"], code: [], tests: [], gaps: ["Kein Publisher-Code", "App-Registrierung/OAuth nicht nachgewiesen", "Nicht in der Datenschutzerklärung als Veröffentlichungskanal beschrieben"],
    operation: { type: "planned" } }),

  // ---- Infrastruktur ----
  n({ id: "vercel", label: "Vercel (Hosting)", short: "Vercel", kind: "infra", cluster: "infra", since: "main", effects: false,
    plain: "Hier läuft die Anwendung (Region Frankfurt).", summary: "Next.js-Hosting und Functions, Region fra1. Preview und Production teilen teils Ressourcen.",
    responsibilities: ["Hosting"], code: ["vercel.json", "next.config.ts"], tests: [], gaps: ["Preview-Isolation offen (docs/PREVIEW_ISOLATION_MATRIX.md)"], operation: CODE }),
  n({ id: "postgres", label: "Postgres (Neon)", short: "Datenbank", kind: "infra", cluster: "infra", since: "main", effects: true,
    plain: "Gedächtnis des Systems: Aufträge, Freigaben, Verlauf, Content-Chancen.", summary: "Migrationen 001–035, automatisch beim ersten Aufruf angewendet (additiv).",
    responsibilities: ["Persistenz"], code: ["lib/memory/db.ts", "lib/memory/migrations.ts", "db/migrations/"], tests: ["tests/memory.test.cjs", "tests/migration-upgrade.test.cjs"],
    gaps: ["Migration 034/035 in Produktion nicht verifiziert", "Von Preview mitgenutzt"], env: ["DATABASE_URL"], operation: { type: "custom", id: "database" },
    proof: "docs/CREDENTIALS.md: produktiv genutzt" }),
  n({ id: "blob", label: "Vercel Blob (Medien)", short: "Blob-Speicher", kind: "infra", cluster: "infra", since: "main", effects: true,
    plain: "Speicher für erzeugte Bilder und Videos.", summary: "Medienablage; Schreibzugriffe nur über guarded-blob.", responsibilities: ["Medienablage"],
    code: ["lib/security/guarded-blob.ts"], tests: ["tests/runtime-guard.test.cjs"], gaps: ["Von Preview mitgenutzt"], env: ["BLOB_READ_WRITE_TOKEN"], operation: { type: "services", ids: ["blob"] },
    proof: "docs/CREDENTIALS.md: Produkt-Pipeline produktiv" }),
  n({ id: "cron", label: "Zeitpläne (Cron)", short: "Cron", kind: "infra", cluster: "infra", since: "main", effects: true,
    plain: "Startet die täglichen Läufe automatisch.", summary: "daily-draft (6×/Tag), weekly-report; topic-scout bewusst nicht eingetragen.",
    responsibilities: ["Tageslauf", "Wochenbericht"], code: ["vercel.json", "app/api/cron/"], tests: ["tests/daily-cron-time.test.cjs", "tests/topic-cron.test.cjs"], gaps: [], env: ["CRON_SECRET"],
    operation: { type: "env", anyOf: [["CRON_SECRET"]] } }),
  n({ id: "observability", label: "Protokolle & Status", short: "Protokolle", kind: "module", cluster: "infra", since: "main", effects: false,
    plain: "Schreibt nachvollziehbare Ereignisse ohne Geheimnisse und meldet, welche Zugänge fehlen.", summary: "Strukturierte Events; Capability-Matrix nur mit Variablennamen.",
    responsibilities: ["Events", "Status der Zugänge"], code: ["lib/observability/events.ts", "lib/capabilities/index.ts"], tests: ["tests/capabilities.test.cjs"], gaps: [], operation: CODE }),
  n({ id: "meta-api", label: "Meta Graph / WhatsApp Cloud API", short: "Meta-API", kind: "external", cluster: "infra", since: "main", effects: true,
    plain: "Externe Schnittstelle von Meta für WhatsApp, Instagram und Facebook.", summary: "Externe API; keine eigene Logik.", responsibilities: [],
    code: ["lib/meta/connection.ts", "lib/whatsapp/client.ts"], tests: ["tests/meta.test.cjs"], gaps: [], operation: { type: "env", anyOf: [["META_SYSTEM_USER_TOKEN"], ["META_PAGE_ACCESS_TOKEN"]] },
    proof: "docs/CREDENTIALS.md: WhatsApp produktiv" }),
];

export const EDGES: ArchEdge[] = [
  // Recherche → Trendsetter → Jarvis → Pipelines
  { id: "d-tavily-trend", from: "tavily", to: "trend-agent", kind: "external", label: "Suche" },
  { id: "d-tavily-topic", from: "tavily", to: "topic-scout", kind: "external", label: "News" },
  { id: "d-trend-setter", from: "trend-agent", to: "trendsetter", kind: "data", label: "Produkt- und Themenchancen" },
  { id: "d-topic-setter", from: "topic-scout", to: "trendsetter", kind: "data", label: "Themenkandidaten" },
  { id: "o-setter-jarvis", from: "trendsetter", to: "jarvis", kind: "orchestration", label: "Content-Chancen mit Empfehlung" },
  { id: "o-jarvis-product-scout", from: "jarvis", to: "product-scout", kind: "orchestration", label: "nur nach Affiliate-Zuweisung" },
  { id: "o-jarvis-topic", from: "jarvis", to: "topic-orchestrator", kind: "orchestration", label: "Themen-Zuweisung" },
  { id: "d-scout-reviewer", from: "product-scout", to: "product-reviewer", kind: "data", label: "Produktkandidat" },
  { id: "d-reviewer-guard", from: "product-reviewer", to: "affiliate-guard", kind: "data", label: "Produktidentität" },
  { id: "d-setter-pg", from: "trendsetter", to: "postgres", kind: "data", label: "gemeinsame Chancen + Zeitsperren" },
  // Kreativ
  ...["creative-agent", "video-agent", "image-agent", "text-agent", "marketing-agent"].map(id => ({ id: `o-jarvis-${id}`, from: "jarvis", to: id, kind: "orchestration" as const, label: "beauftragt" })),
  { id: "o-jarvis-router", from: "jarvis", to: "format-router", kind: "orchestration", label: "Formatwahl" },
  { id: "o-jarvis-script", from: "jarvis", to: "script-writer", kind: "orchestration", label: "Referenzmodus" },
  { id: "o-topic-router", from: "topic-orchestrator", to: "format-router", kind: "orchestration", label: "Formatwahl" },
  // Produktion + Qualität
  { id: "o-topic-visual", from: "topic-orchestrator", to: "visual-engine", kind: "orchestration", label: "Medien erzeugen" },
  { id: "d-visual-replicate", from: "visual-engine", to: "replicate", kind: "external", label: "Bilder" },
  { id: "d-visual-runway", from: "visual-engine", to: "runway", kind: "external", label: "Standard-Video (opt-in)" },
  { id: "d-visual-heygen", from: "visual-engine", to: "heygen", kind: "external", label: "Avatar-Video" },
  { id: "d-visual-blob", from: "visual-engine", to: "blob", kind: "data", label: "Medien speichern" },
  { id: "a-visual-vision", from: "visual-engine", to: "vision-gate", kind: "approval", label: "Bild prüfen" },
  { id: "a-jarvis-vision", from: "jarvis", to: "vision-gate", kind: "approval", label: "Produktbild prüfen" },
  { id: "d-vision-replicate", from: "vision-gate", to: "replicate", kind: "external", label: "Vision-Modell" },
  { id: "d-jarvis-openai", from: "jarvis", to: "openai-image", kind: "external", label: "Bild-Ausweich" },
  { id: "d-prod-runway", from: "production-gate", to: "runway", kind: "external", label: "nach Kostenfreigabe" },
  { id: "d-prod-faceless", from: "production-gate", to: "faceless", kind: "external", label: "Altpfad, nicht eingesetzt", planned: true },
  // Freigaben
  { id: "a-jarvis-content", from: "jarvis", to: "content-approval", kind: "approval", label: "Inhalt zur Freigabe" },
  { id: "a-topic-content", from: "topic-orchestrator", to: "content-approval", kind: "approval", label: "Themenvorschlag" },
  { id: "a-content-whatsapp", from: "content-approval", to: "whatsapp", kind: "approval", label: "Nachricht" },
  { id: "a-whatsapp-prod", from: "whatsapp", to: "production-gate", kind: "approval", label: "Kostenfreigabe" },
  { id: "a-whatsapp-publish", from: "whatsapp", to: "publish-gate", kind: "approval", label: "„Freigeben“" },
  { id: "a-exec-publish", from: "executive-agent", to: "publish-gate", kind: "approval", label: "geplant", planned: true },
  { id: "e-whatsapp-meta", from: "whatsapp", to: "meta-api", kind: "external", label: "Cloud API" },
  // Publishing
  { id: "p-gate-publisher", from: "publish-gate", to: "publisher", kind: "approval", label: "Permit je Fassung" },
  { id: "o-topic-publisher", from: "topic-orchestrator", to: "publisher", kind: "orchestration", label: "Verteilung" },
  { id: "d-guard-publisher", from: "affiliate-guard", to: "publisher", kind: "data", label: "Link-Regeln" },
  ...["instagram", "facebook", "tiktok", "youtube", "x"].map(id => ({ id: `p-publisher-${id}`, from: "publisher", to: id, kind: "publishing" as const, label: "Adapter" })),
  { id: "p-publisher-pinterest", from: "publisher", to: "pinterest", kind: "publishing", label: "geplant", planned: true },
  { id: "p-publisher-whatsapp", from: "publisher", to: "whatsapp", kind: "data", label: "Status + Links" },
  { id: "e-ig-meta", from: "instagram", to: "meta-api", kind: "external", label: "Graph API" },
  { id: "e-fb-meta", from: "facebook", to: "meta-api", kind: "external", label: "Graph API" },
  // Infrastruktur + Sicherheit
  { id: "i-vercel-cron", from: "vercel", to: "cron", kind: "orchestration", label: "löst aus" },
  { id: "i-cron-jarvis", from: "cron", to: "jarvis", kind: "orchestration", label: "Tageslauf" },
  { id: "i-cron-topic", from: "cron", to: "topic-orchestrator", kind: "orchestration", label: "nicht eingetragen", planned: true },
  { id: "i-vercel-jarvis", from: "vercel", to: "jarvis", kind: "orchestration", label: "hostet" },
  { id: "i-auth-jarvis", from: "api-auth", to: "jarvis", kind: "approval", label: "schützt Studio-API" },
  { id: "i-guard-publisher", from: "runtime-guard", to: "publisher", kind: "approval", label: "sperrt Preview" },
  { id: "i-guard-visual", from: "runtime-guard", to: "visual-engine", kind: "approval", label: "sperrt Bezahl-Anbieter (Preview)" },
  { id: "i-obs-jarvis", from: "observability", to: "jarvis", kind: "data", label: "Ereignisse" },
  { id: "i-jarvis-pg", from: "jarvis", to: "postgres", kind: "data", label: "Aufträge" },
  { id: "i-topic-pg", from: "topic-orchestrator", to: "postgres", kind: "data", label: "Läufe/Versionen" },
  { id: "i-vercel-blob", from: "vercel", to: "blob", kind: "data", label: "Blob-Token" },
];

// The actual flow of a topic post, in order. Each step names the components that do the work.
// flow "fan_in": all components of the step feed its last one; default: they follow each other.
export const PROCESS_STEPS: { id: string; label: string; plain: string; nodes: string[]; flow?: "fan_in" }[] = [
  { id: "find", label: "Chancen finden", plain: "Trend-Recherche und Themen-Quellen liefern Kandidaten; der Trendsetter vereinheitlicht sie.", nodes: ["topic-scout", "trend-agent", "trendsetter"], flow: "fan_in" },
  { id: "decide", label: "Jarvis entscheidet", plain: "Jarvis prüft, sperrt Doppelungen und weist die Chance einer Pipeline zu.", nodes: ["jarvis"] },
  { id: "create", label: "Idee entwickeln", plain: "Hook, Nutzwert, Text und Call-to-Action.", nodes: ["creative-agent"] },
  { id: "format", label: "Format wählen", plain: "Text, Bild, Karussell oder Video – nach Nutzen und Kosten.", nodes: ["format-router"] },
  { id: "produce", label: "Medien erzeugen", plain: "Bilder, Grafiken oder Videos über die Anbieter.", nodes: ["visual-engine"] },
  { id: "check", label: "Qualität prüfen", plain: "Automatische Bildprüfung; Fehlerhaftes geht nicht weiter.", nodes: ["vision-gate"] },
  { id: "approve", label: "WhatsApp-Freigaben", plain: "Inhalt, ggf. Kosten, dann die finale Veröffentlichungsfreigabe.", nodes: ["content-approval", "production-gate", "publish-gate"] },
  { id: "publish", label: "Veröffentlichen", plain: "Nur auf freigegebenen Plattformen, jede einzeln.", nodes: ["publisher"] },
  { id: "report", label: "Rückmeldung", plain: "Ergebnis und echte Links per WhatsApp.", nodes: ["whatsapp"] },
];

export const ARCHITECTURE_META = {
  version: 2,
  basis: "Code-, Test- und Dokuanalyse des Repositories (Branch von PR #64). Betriebsstatus wird beim Laden auf dem Server ermittelt.",
} as const;

export function implementationOf(node: Pick<ArchNode, "code" | "tests" | "operation">): ImplementationStatus {
  if (node.operation.type === "planned" || !node.code.length) return "planned";
  return node.tests.length ? "tested" : "implemented";
}
export function deploymentOf(node: Pick<ArchNode, "since">): DeploymentStatus {
  return node.since === "main" ? "production" : node.since === "pr64" ? "preview" : "not_deployed";
}
export function nodeById(id: string) { return NODES.find(node => node.id === id); }
export function neighbours(id: string): string[] {
  return [...new Set(EDGES.flatMap(edge => edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : []))];
}
export function validateModel(nodes: ArchNode[] = NODES, edges: ArchEdge[] = EDGES): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.id)) problems.push(`duplicate node ${node.id}`);
    ids.add(node.id);
    if (node.short.length > 22) problems.push(`short label too long ${node.id}`);
  }
  const edgeIds = new Set<string>();
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) problems.push(`duplicate edge ${edge.id}`);
    edgeIds.add(edge.id);
    if (!ids.has(edge.from) || !ids.has(edge.to)) problems.push(`dangling edge ${edge.id}`);
  }
  for (const step of PROCESS_STEPS) for (const id of step.nodes) if (!ids.has(id)) problems.push(`process step ${step.id} names unknown node ${id}`);
  return problems;
}
