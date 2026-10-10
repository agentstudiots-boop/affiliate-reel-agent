import type { ServiceCapability } from "../capabilities";
import { runtimeEnvironment, sandboxDeclared } from "../security/runtime-guard";
import { NODES, PROCESS_STEPS, type ArchNode, type OperationalStatus } from "./model";
import type { RuntimeSnapshot } from "./snapshot";

// Operational status per component, computed on the server at request time. Inputs: capability check (variable NAMES
// only), documented switches, the deployment environment and read-only database evidence. Every status carries its
// source and reason; nothing is inferred beyond these inputs. No value of any variable leaves the server.

type Env = Record<string, string | undefined>;
export type StatusSource = "Konfiguration" | "Datenbank" | "Repo-Analyse" | "Betreiberentscheidung" | "Preview-Sperre";
export type NodeRuntime = { status: OperationalStatus; reason: string; source: StatusSource; details: string[] };
export type StepRuntime = { id: string; status: OperationalStatus; counts: string[] };
export type RuntimeState = {
  generatedAt: string;
  environment: "production" | "preview" | "development" | "local";
  sandbox: boolean;
  flags: { topicPipeline: boolean; livePublishing: boolean; trendsetterAffiliate: string; topicPostsPerDay: number; qualityGate: string };
  nodes: Record<string, NodeRuntime>;
  steps: StepRuntime[];
  evidence: { available: boolean; reason: string | null; generatedAt: string };
  pending: { label: string; count: number }[];
  publications: { platform: string; status: string; url: string | null; at: string; origin: string }[];
  recentTopics: NonNullable<RuntimeSnapshot["topic"]>["recent"];
  recentChances: NonNullable<RuntimeSnapshot["chances"]>["recent"];
};

const SEVERITY: OperationalStatus[] = ["error", "not_configured", "unknown", "disabled", "active", "ready", "not_applicable"];
export const worst = (statuses: OperationalStatus[]) => SEVERITY.find(status => statuses.includes(status)) ?? "unknown";
const set = (env: Env, name: string) => !!env[name]?.trim();

export function readFlags(env: Env = process.env): RuntimeState["flags"] {
  const mode = env.TRENDSETTER_AFFILIATE?.trim();
  return {
    topicPipeline: env.TOPIC_PIPELINE_ENABLED === "true",
    livePublishing: env.TOPIC_LIVE_PUBLISHING === "true",
    trendsetterAffiliate: mode === "record" || mode === "route" ? mode : "off",
    topicPostsPerDay: Math.max(1, Math.min(4, Math.floor(Number(env.TOPIC_POSTS_PER_DAY)) || 1)),
    qualityGate: env.IMAGE_QUALITY_GATE === "off" ? "off" : set(env, "REPLICATE_API_TOKEN") ? "strict" : "unavailable",
  };
}

function base(node: ArchNode, env: Env, caps: Map<string, ServiceCapability>, snapshot: RuntimeSnapshot, flags: RuntimeState["flags"]): NodeRuntime {
  const rule = node.operation;
  const ok = (reason: string, source: StatusSource = "Konfiguration", details: string[] = []): NodeRuntime => ({ status: "ready", reason, source, details });
  switch (rule.type) {
    case "planned": return { status: "not_applicable", reason: "Geplant – kein Code, der laufen könnte", source: "Repo-Analyse", details: [] };
    case "code": return ok("Code im Deployment, keine eigene Konfiguration nötig", "Repo-Analyse");
    case "policy": return { status: rule.status, reason: rule.reason, source: "Betreiberentscheidung", details: [] };
    case "flag": return env[rule.flag] === "true" ? ok(`${rule.label} eingeschaltet (${rule.flag})`)
      : { status: "disabled", reason: `${rule.label} ausgeschaltet (${rule.flag} ist nicht "true")`, source: "Konfiguration", details: [] };
    case "env": {
      const present = rule.anyOf.some(group => group.every(name => set(env, name)));
      return present ? ok("Benötigte Variablen gesetzt", "Konfiguration", rule.note ? [rule.note] : [])
        : { status: "not_configured", reason: `Fehlt: ${rule.anyOf.map(group => group.join(" + ")).join(" oder ")}`, source: "Konfiguration", details: rule.note ? [rule.note] : [] };
    }
    case "services": {
      const list = rule.ids.map(id => caps.get(id)).filter((item): item is ServiceCapability => !!item);
      const blocked = list.filter(item => item.state === "blockiert");
      const off = list.filter(item => item.state === "nicht_aktiviert");
      const details = [...list.map(item => `${item.label}: ${item.reason}`), ...(rule.note ? [rule.note] : [])];
      if (blocked.length) return { status: "not_configured", reason: `Fehlt: ${[...new Set(blocked.flatMap(item => item.missing))].join(", ")}`, source: "Konfiguration", details };
      if (off.length) return { status: "disabled", reason: off.map(item => item.reason).join("; "), source: "Konfiguration", details };
      const dry = list.some(item => item.state === "nur_dry_run");
      return ok(dry ? "Zugang vorhanden – Live-Veröffentlichung aus, nur Probelauf" : "Zugang vorhanden", "Konfiguration", details);
    }
    case "custom": {
      if (rule.id === "trendsetter") {
        if (!flags.topicPipeline && flags.trendsetterAffiliate === "off")
          return { status: "disabled", reason: "Wird erst genutzt mit Themen-Pipeline (TOPIC_PIPELINE_ENABLED) oder TRENDSETTER_AFFILIATE=record|route", source: "Konfiguration", details: [] };
        return ok("Eingeschaltet", "Konfiguration", [`Themen-Pipeline: ${flags.topicPipeline ? "an" : "aus"}`, `Affiliate-Anbindung: ${flags.trendsetterAffiliate}`]);
      }
      if (rule.id === "vision") {
        if (flags.qualityGate === "off") return { status: "disabled", reason: "IMAGE_QUALITY_GATE=off – Bilder gehen ungeprüft (als ungeprüft markiert) zur Freigabe", source: "Konfiguration", details: [] };
        if (flags.qualityGate === "unavailable") return { status: "not_configured", reason: "Fehlt: REPLICATE_API_TOKEN – ohne Prüfung geht kein Bild automatisch zur Freigabe", source: "Konfiguration", details: [] };
        if (snapshot.vision && snapshot.vision.checked > 0) return ok(`Laufzeitnachweis: ${snapshot.vision.checked} Bild(er) vom Vision-Modell geprüft`, "Datenbank",
          snapshot.vision.lastStatus ? [`Letztes Ergebnis: ${snapshot.vision.lastStatus}`] : []);
        return { status: "unknown", reason: "Konfiguriert, aber die Bildfähigkeit des Modells ist nicht nachgewiesen (Smoke-Test Stufe 2 steht aus)", source: snapshot.available ? "Datenbank" : "Konfiguration", details: [] };
      }
      if (rule.id === "publisher") return ok(flags.livePublishing ? "Live-Veröffentlichung eingeschaltet (TOPIC_LIVE_PUBLISHING)" : "Themen-Pfad: nur Probelauf (TOPIC_LIVE_PUBLISHING aus)", "Konfiguration",
        ["Produkt-Pipeline: Facebook/Instagram nach eigener WhatsApp-Freigabe (bestehender Weg)"]);
      if (rule.id === "database") {
        if (!set(env, "DATABASE_URL")) return { status: "not_configured", reason: "Fehlt: DATABASE_URL", source: "Konfiguration", details: [] };
        return snapshot.available ? ok("Lesend erreichbar", "Datenbank") : { status: "unknown", reason: snapshot.reason ?? "Nicht lesbar", source: "Datenbank", details: [] };
      }
      if (rule.id === "runway") return set(env, "RUNWAYML_API_SECRET")
        ? ok("Zugang vorhanden (Produkt-Pipeline nach Kostenfreigabe)", "Konfiguration", [env.TOPIC_STANDARD_VIDEO_PROVIDER === "runway" ? "Themen-Pfad: eingeschaltet" : "Themen-Pfad: aus (TOPIC_STANDARD_VIDEO_PROVIDER≠runway)"])
        : { status: "not_configured", reason: "Fehlt: RUNWAYML_API_SECRET", source: "Konfiguration", details: [] };
      return { status: "unknown", reason: "Keine Regel", source: "Repo-Analyse", details: [] };
    }
  }
}

const day = (iso: string, now: Date) => (now.getTime() - Date.parse(iso)) / 86_400_000;
const when = (iso: string) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

// Runtime evidence can turn "ready" into "active" (work in progress) or "error" (last documented run failed).
function withEvidence(id: string, current: NodeRuntime, snapshot: RuntimeSnapshot, now: Date): NodeRuntime {
  if (!snapshot.available || current.status === "not_applicable" || current.status === "disabled") return current;
  const db = (status: OperationalStatus, reason: string, details: string[] = []): NodeRuntime => ({ status, reason, source: "Datenbank", details: [...details, ...current.details] });
  const topic = snapshot.topic;
  if (id === "topic-orchestrator" && topic) {
    const working = (topic.byStage.producing ?? 0) + (topic.byStage.in_production ?? 0) + (topic.byStage.publishing ?? 0);
    const failed = topic.recent.find(item => item.stage === "failed" && day(item.at, now) <= 1);
    if (failed) return db("error", `Letzter Themenbeitrag fehlgeschlagen (${when(failed.at)}): ${failed.error ?? "ohne Angabe"}`);
    if (working) return db("active", `${working} Themenbeitrag/-beiträge in Produktion oder Veröffentlichung`);
  }
  if (id === "jarvis" && snapshot.affiliate?.runningJobs) return db("active", `${snapshot.affiliate.runningJobs} Content-Auftrag/-Aufträge in Bearbeitung (24 h)`);
  if ((id === "content-approval" || id === "publish-gate") && (snapshot.affiliate || topic)) {
    const waiting = id === "content-approval" ? (snapshot.affiliate?.pendingContentApprovals ?? 0) + (topic?.byStage.proposed ?? 0)
      : (snapshot.affiliate?.pendingPublications ?? 0) + (topic?.byStage.awaiting_publish_approval ?? 0);
    if (waiting) return db("active", `${waiting} wartet/warten auf deine Freigabe`);
  }
  if (id === "visual-engine" && snapshot.visualJobs?.length) {
    if (snapshot.visualJobs.some(job => job.status === "running")) return db("active", "Ein Medienauftrag läuft");
    const latest = [...snapshot.visualJobs].sort((a, b) => b.at.localeCompare(a.at))[0];
    if (latest.status === "failed" && day(latest.at, now) <= 1) return db("error", `Letzter Medienauftrag fehlgeschlagen (${latest.kind}, ${when(latest.at)})`);
  }
  if (snapshot.publications) {
    const own = snapshot.publications.filter(item => item.platform === id);
    if (own.length) {
      const latest = own[0];
      const lastLive = own.find(item => item.status === "published");
      const detail = lastLive ? [`Zuletzt veröffentlicht: ${when(lastLive.at)}${lastLive.url ? ` – ${lastLive.url}` : " (Link nicht geliefert)"}`] : [];
      if (latest.status === "processing") return db("active", "Veröffentlichung wird von der Plattform noch verarbeitet", detail);
      if (latest.status === "failed") return db("error", `Letzter Veröffentlichungsversuch fehlgeschlagen (${when(latest.at)})`, detail);
      if (latest.status === "unknown") return db("unknown", `Ergebnis des letzten Versuchs unklar (${when(latest.at)}) – wird nicht automatisch wiederholt`, detail);
      return { ...current, details: [...detail, ...current.details] };
    }
  }
  return current;
}

export function computeRuntime(input: { capabilities: ServiceCapability[]; snapshot: RuntimeSnapshot; env?: Env; now?: Date; nodes?: ArchNode[] }): RuntimeState {
  const env = input.env ?? process.env;
  const now = input.now ?? new Date();
  const flags = readFlags(env);
  const environment = runtimeEnvironment(env);
  const sandbox = sandboxDeclared(env);
  const caps = new Map(input.capabilities.map(item => [item.id, item]));
  const nodes: Record<string, NodeRuntime> = {};
  for (const node of input.nodes ?? NODES) {
    let state = base(node, env, caps, input.snapshot, flags);
    // Preview/development without a declared sandbox: every external effect is blocked by the runtime guard.
    if ((environment === "preview" || environment === "development") && !sandbox && node.effects && state.status !== "not_applicable")
      state = { status: "disabled", reason: "Preview: externe Wirkungen gesperrt (Runtime-Guard)", source: "Preview-Sperre", details: [`Ohne Sperre wäre: ${state.reason}`] };
    nodes[node.id] = withEvidence(node.id, state, input.snapshot, now);
  }
  const s = input.snapshot;
  const steps: StepRuntime[] = PROCESS_STEPS.map(step => {
    const counts: string[] = [];
    if (step.id === "find" && s.chances) counts.push(`${s.chances.last24h} Chance(n) in 24 h`);
    if (step.id === "decide" && s.chances) counts.push(`${s.chances.openRoutes} offene Zuweisung(en)`);
    if (step.id === "produce" && s.topic) counts.push(`${(s.topic.byStage.producing ?? 0) + (s.topic.byStage.in_production ?? 0)} in Produktion`);
    if (step.id === "approve") {
      if (s.topic) counts.push(`${s.topic.byStage.proposed ?? 0} Themenvorschlag/-vorschläge`, `${s.topic.byStage.awaiting_publish_approval ?? 0} Veröffentlichungsfreigabe(n)`);
      if (s.affiliate) counts.push(`${s.affiliate.pendingContentApprovals + s.affiliate.pendingPublications} Produkt-Freigabe(n)`);
    }
    if (step.id === "publish" && s.publications) counts.push(`${s.publications.filter(item => item.status === "published").length} der letzten ${s.publications.length} Versuche live`);
    return { id: step.id, status: worst(step.nodes.map(id => nodes[id]?.status ?? "unknown")), counts };
  });
  const pending = [
    { label: "Themenvorschläge (Inhalt/Kosten)", count: s.topic?.byStage.proposed ?? 0 },
    { label: "Themen: Veröffentlichungsfreigaben", count: s.topic?.byStage.awaiting_publish_approval ?? 0 },
    { label: "Produkt-Pipeline: Inhaltsfreigaben", count: s.affiliate?.pendingContentApprovals ?? 0 },
    { label: "Produkt-Pipeline: Veröffentlichungsfreigaben", count: s.affiliate?.pendingPublications ?? 0 },
  ];
  return { generatedAt: now.toISOString(), environment, sandbox, flags, nodes, steps, evidence: { available: s.available, reason: s.reason, generatedAt: s.generatedAt },
    pending: s.available ? pending : [], publications: s.publications ?? [], recentTopics: s.topic?.recent ?? [], recentChances: s.chances?.recent ?? [] };
}
