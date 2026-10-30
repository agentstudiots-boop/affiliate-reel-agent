import { getDatabase, type Sql } from "../memory/db";
import { reliablePostUrl } from "../publishing/report";
import { DAILY_OUTCOMES, DELIVERY } from "../enterprise/departments/affiliate";
import type { ServiceCapability } from "../capabilities";

// Operations view of the Command Center: one row of stations per content path, from the topic to the results.
// Read-only like snapshot.ts: SELECT statements in READ ONLY transactions, each section isolated, no writes, no provider
// or messaging calls. A station is "belegt" only with database evidence of a successful run; configuration alone never
// makes a station green. Missing figures (reach, revenue, prices) are null ("unbekannt"), never 0.

export type StationState = "belegt" | "wartet_betreiber" | "blockiert" | "aus" | "unbekannt";
export type Owner = "Betreiber" | "System" | "Entwicklung";
export type StationCurrent = { contentId: string | null; status: string; at: string | null; blocker: string | null };
export type Publication = { platform: string; status: string; externalId: string | null; url: string | null; at: string | null };
export type Metric = { label: string; value: number | null; basis: string };
export type Station = {
  id: "topic" | "draft" | "media" | "approvals" | "publication" | "results";
  label: string;
  state: StationState;
  reason: string;
  source: string[];
  lastOkAt: string | null;
  current: StationCurrent | null;
  next: { action: string; owner: Owner } | null;
  publications?: Publication[];
  metrics?: Metric[];
};
export type Track = { id: "affiliate" | "topic"; label: string; plain: string; stations: Station[] };
// whatsapp_events holds every processed inbound message; the 24 h window opens with the operator's last message.
export type ServiceWindow = { lastInboundAt: string | null; openUntil: string | null; open: boolean | null; basis: string };
export type UndeliveredCount = { drafts: number; runs: number; since: string; basis: string };
export type PipelineView = {
  available: boolean;
  reason: string | null;
  generatedAt: string;
  serviceWindow: ServiceWindow | null;
  undelivered: UndeliveredCount | null;
  tracks: Track[];
};
export type PipelineSwitches = { topicPipeline: boolean; topicDailyVideo: boolean; livePublishing: boolean };

type Row = Record<string, unknown>;
type Readable = Sql & { transaction?: <T>(fn: (sql: Sql) => Promise<T>) => Promise<T> };
const WINDOW_MS = 24 * 3600_000;
const WEEK_MS = 7 * 24 * 3600_000;

async function section<T>(db: Readable, work: (sql: Sql) => Promise<T>): Promise<T | null> {
  try {
    if (!db.transaction) return await work(db);
    return await db.transaction(async sql => { await sql.query("SET TRANSACTION READ ONLY"); return work(sql); });
  } catch { return null; }
}
const at = (value: unknown) => value ? new Date(String(value)).toISOString() : null;
const text = (value: unknown, max = 140) => value === null || value === undefined || value === "" ? null : String(value).replace(/https?:\/\/\S+/g, "[URL]").slice(0, max);
const first = async (sql: Sql, query: string, values: unknown[] = []) => ((await sql.query(query, values)).rows[0] ?? null) as Row | null;

// Highest WhatsApp delivery status per message (read > delivered > sent; failed wins only without a later success).
const DELIVERY_STATUS = `(SELECT CASE WHEN bool_or(status='read') THEN 'read' WHEN bool_or(status='delivered') THEN 'delivered'
  WHEN bool_or(status='failed') THEN 'failed' WHEN bool_or(status='sent') THEN 'sent' END FROM whatsapp_delivery_statuses d WHERE d.message_id = %s)`;
const deliveryOf = (column: string) => DELIVERY_STATUS.replace("%s", column);
const DELIVERY_LABEL: Record<string, string> = { read: "gelesen", delivered: "zugestellt", sent: "gesendet, Zustellung offen", failed: "Zustellung fehlgeschlagen" };

const station = (id: Station["id"], label: string, input: Omit<Station, "id" | "label">): Station => ({ id, label, ...input });
const UNREADABLE = "Nachweis nicht lesbar (Tabelle fehlt oder Abfrage fehlgeschlagen)";
// A section that could not be read (missing table, broken query) is "unbekannt" with that reason – never "ok".
const unreadable = (id: Station["id"], label: string, source: string[]): Station =>
  station(id, label, { state: "unbekannt", reason: UNREADABLE, source, lastOkAt: null, current: null, next: null });

export async function readPipelineView(input: { capabilities: ServiceCapability[]; switches: PipelineSwitches; now?: Date; open?: () => Readable }): Promise<PipelineView> {
  const now = input.now ?? new Date();
  let handle: Readable;
  try { handle = (input.open ?? getDatabase)(); }
  catch (error) {
    const blocked = error instanceof Error && /non_production_effect_blocked/.test(error.message);
    return { available: false, reason: blocked ? "Preview/Entwicklung: Datenbankzugriff durch den Runtime-Guard gesperrt" : "Keine Datenbank erreichbar oder nicht konfiguriert",
      generatedAt: now.toISOString(), serviceWindow: null, undelivered: null, tracks: [] };
  }
  const caps = new Map(input.capabilities.map(item => [item.id, item]));
  const serviceWindow = await section(handle, async sql => {
    const last = at((await first(sql, "SELECT max(received_at) AS last FROM whatsapp_events"))?.last);
    const until = last ? new Date(Date.parse(last) + WINDOW_MS).toISOString() : null;
    return { lastInboundAt: last, openUntil: until, open: until ? Date.parse(until) > now.getTime() : false,
      basis: "letzte eingehende, verarbeitete WhatsApp-Nachricht (whatsapp_events) + 24 h" };
  });
  const undelivered = await readUndelivered(handle, now);
  const affiliate = await readAffiliate(handle, now, serviceWindow);
  const topic = await readTopic(handle, input.switches, caps);
  const readable = !!serviceWindow || !!undelivered || [...affiliate.stations, ...topic.stations].some(item => item.reason !== UNREADABLE && item.source[0] !== "nicht erfasst");
  return { available: readable, reason: readable ? null : "Keine erfolgreiche Datenbankabfrage", generatedAt: now.toISOString(), serviceWindow, undelivered, tracks: [affiliate, topic] };
}

// Undelivered approval requests of the daily draft: daily_slot_runs has one row per cron call, and a slot is called up to
// three times – so the same draft can be counted several times. Distinct drafts and calls are shown side by side.
async function readUndelivered(handle: Readable, now: Date): Promise<UndeliveredCount | null> {
  const since = new Date(now.getTime() - WEEK_MS).toISOString();
  return section(handle, async sql => {
    const row = await first(sql, `WITH runs AS (SELECT job_id,
        ((outcome = $2 AND (whatsapp IS NULL OR NOT whatsapp = ANY($3::text[]))) OR (whatsapp IS NOT NULL AND NOT whatsapp = ANY($3::text[]))) AS undelivered
        FROM daily_slot_runs WHERE invoked_at > $1::timestamptz)
      SELECT count(*) FILTER (WHERE undelivered)::int AS runs, count(DISTINCT job_id) FILTER (WHERE undelivered)::int AS drafts FROM runs`,
    [since, DAILY_OUTCOMES.draft, [...DELIVERY.delivered]]);
    return { drafts: Number(row?.drafts ?? 0), runs: Number(row?.runs ?? 0), since,
      basis: "daily_slot_runs, 7 Tage: eindeutige Entwürfe (job_id) und Cron-Aufrufe ohne zugestellte Freigabeanfrage" };
  });
}

async function readAffiliate(handle: Readable, now: Date, window: ServiceWindow | null): Promise<Track> {
  const windowClosed = window?.open === false;
  const topic = await section(handle, async sql => {
    const last = await first(sql, `SELECT invoked_at, day, slot, outcome, whatsapp, job_id, reason FROM daily_slot_runs
      WHERE outcome <> ALL($1::text[]) OR whatsapp IS NOT NULL ORDER BY invoked_at DESC LIMIT 1`, [[...DAILY_OUTCOMES.idle]]);
    const ok = await first(sql, "SELECT max(invoked_at) AS last FROM daily_slot_runs WHERE outcome = $1", [DAILY_OUTCOMES.draft]);
    const failed = !!last && (DAILY_OUTCOMES.failures as readonly string[]).includes(String(last.outcome));
    return station("topic", "Produkt & Trend", {
      state: !last ? "unbekannt" : failed ? "blockiert" : "belegt",
      reason: !last ? "noch kein Tageslauf protokolliert" : failed ? `letzter Tageslauf fehlgeschlagen${last.reason ? `: ${text(last.reason, 80)}` : ""}` : `letzter Tageslauf: ${String(last.outcome)}`,
      source: ["daily_slot_runs"], lastOkAt: at(ok?.last),
      current: last ? { contentId: last.job_id ? String(last.job_id) : null, status: `${String(last.day ?? "")} ${String(last.slot ?? "")}: ${String(last.outcome)}`.trim(), at: at(last.invoked_at),
        blocker: failed ? text(last.reason, 120) : null } : null,
      next: failed ? { action: "Fehlerursache prüfen (Laufzeitlog nur 1 h, Grund steht in daily_slot_runs)", owner: "Entwicklung" } : { action: "nächster Slot läuft automatisch (Cron)", owner: "System" },
    });
  }) ?? unreadable("topic", "Produkt & Trend", ["daily_slot_runs"]);

  const draft = await section(handle, async sql => {
    const last = await first(sql, "SELECT id, status, updated_at FROM content_jobs ORDER BY updated_at DESC LIMIT 1");
    const ok = await first(sql, "SELECT max(created_at) AS last FROM content_approval_requests");
    return station("draft", "Entwurf", {
      state: ok?.last ? "belegt" : "unbekannt",
      reason: ok?.last ? "Entwurf hat die Freigabestufe erreicht" : last ? "Entwurf vorhanden, noch keine Freigabeanfrage" : "noch kein Entwurf",
      source: ["content_jobs", "content_approval_requests"], lastOkAt: at(ok?.last),
      current: last ? { contentId: String(last.id), status: String(last.status), at: at(last.updated_at), blocker: null } : null,
      next: null,
    });
  }) ?? unreadable("draft", "Entwurf", ["content_jobs"]);

  const media = await section(handle, async sql => {
    const last = await first(sql, "SELECT job_id, attempt_no, status, quality_status, updated_at FROM image_generation_attempts ORDER BY updated_at DESC LIMIT 1");
    const ok = await first(sql, "SELECT max(updated_at) AS last FROM image_generation_attempts WHERE quality_status IN ('passed','manual_override')");
    const quality = last?.quality_status ? String(last.quality_status) : null;
    const generationFailed = !!last && ["rejected_by_provider", "failed", "unclear"].includes(String(last.status));
    const stopped = quality === "failed" || quality === "uncertain";
    return station("media", "Bild", {
      state: !last ? "unbekannt" : generationFailed ? "blockiert" : stopped ? "wartet_betreiber" : quality === "passed" || quality === "manual_override" ? "belegt" : "unbekannt",
      reason: !last ? "noch kein Bild erzeugt (Bild entsteht erst nach der Inhaltsfreigabe)" : generationFailed ? `Bildgenerierung: ${String(last.status)}`
        : stopped ? `Bildprüfung: ${quality} – Bildstopp-Nachricht an den Betreiber` : `Bildprüfung: ${quality ?? "noch offen"}`,
      source: ["image_generation_attempts"], lastOkAt: at(ok?.last),
      current: last ? { contentId: String(last.job_id), status: `Versuch ${String(last.attempt_no)}: ${String(last.status)}${quality ? `, Prüfung ${quality}` : ""}`, at: at(last.updated_at),
        blocker: generationFailed ? `Generierung ${String(last.status)}` : stopped ? `Prüfung ${quality}` : null } : null,
      next: stopped ? { action: "auf die Bildstopp-Nachricht antworten (nur die neueste gilt)", owner: "Betreiber" } : generationFailed ? { action: "Ursache prüfen; kein automatischer Neuversuch", owner: "Entwicklung" } : null,
    });
  }) ?? unreadable("media", "Bild", ["image_generation_attempts"]);

  const approvals = await section(handle, async sql => {
    const content = await first(sql, `SELECT job_id, status, created_at, decided_at, whatsapp_message_id, ${deliveryOf("r.whatsapp_message_id")} AS delivery
      FROM content_approval_requests r ORDER BY created_at DESC LIMIT 1`);
    const publication = await first(sql, `SELECT job_id, platform, status, created_at, whatsapp_message_id, ${deliveryOf("p.whatsapp_message_id")} AS delivery
      FROM publication_requests p WHERE status='pending' ORDER BY created_at DESC LIMIT 1`);
    const ok = await first(sql, "SELECT max(decided_at) AS last FROM content_approval_requests WHERE status='approved'");
    const open = publication ?? (content?.status === "pending" ? content : null);
    const kind = publication ? "Veröffentlichungsfreigabe" : "Inhaltsfreigabe";
    const sent = !!open?.whatsapp_message_id;
    const delivery = open?.delivery ? DELIVERY_LABEL[String(open.delivery)] ?? String(open.delivery) : sent ? "kein Zustellstatus gemeldet" : "nicht gesendet";
    const undelivered = !!open && (!sent || open.delivery === "failed");
    return station("approvals", "WhatsApp-Freigaben", {
      state: open ? undelivered ? "blockiert" : "wartet_betreiber" : ok?.last ? "belegt" : "unbekannt",
      reason: open ? `${kind} offen – ${delivery}` : ok?.last ? "keine offene Freigabe" : "noch keine Inhaltsfreigabe erteilt",
      source: ["content_approval_requests", "publication_requests", "whatsapp_delivery_statuses"], lastOkAt: at(ok?.last),
      current: open ? { contentId: String(open.job_id), status: `${kind}: ${delivery}`, at: at(open.created_at),
        blocker: undelivered ? windowClosed ? "24-h-Fenster geschlossen – Freigabeanfrage nicht zugestellt" : "Freigabeanfrage nicht zugestellt" : null } : null,
      next: open ? undelivered ? { action: "kurze WhatsApp-Nachricht senden (öffnet das 24-h-Fenster), danach „Status“", owner: "Betreiber" }
        : { action: `mit „Freigeben“ auf genau diese ${kind}snachricht antworten – oder ablehnen`, owner: "Betreiber" } : null,
    });
  }) ?? unreadable("approvals", "WhatsApp-Freigaben", ["content_approval_requests"]);

  const publication = await section(handle, async sql => {
    const facebook = (await sql.query(`SELECT job_id, status, meta_post_id, permalink, updated_at FROM publication_requests
      WHERE status IN ('published','publishing','unknown') ORDER BY updated_at DESC LIMIT 3`)).rows as Row[];
    const instagram = (await sql.query(`SELECT publication_id, status, media_id, permalink, error_phase, updated_at FROM instagram_image_posts
      WHERE status IN ('published','publishing','processing','failed','unknown') ORDER BY updated_at DESC LIMIT 3`)).rows as Row[];
    const publications: Publication[] = [
      ...facebook.map(row => ({ platform: "facebook", status: String(row.status), externalId: row.meta_post_id ? String(row.meta_post_id) : null,
        url: reliablePostUrl("facebook", row.permalink ? String(row.permalink) : null), at: at(row.updated_at) })),
      ...instagram.map(row => ({ platform: "instagram", status: String(row.status), externalId: row.media_id ? String(row.media_id) : null,
        url: reliablePostUrl("instagram", row.permalink ? String(row.permalink) : null), at: at(row.updated_at) })),
    ].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    const published = publications.filter(item => item.status === "published");
    const unclear = publications.find(item => item.status === "unknown" || item.status === "failed");
    return station("publication", "Veröffentlichung", {
      state: unclear && (!published[0] || (unclear.at ?? "") > (published[0].at ?? "")) ? "blockiert" : published.length ? "belegt" : "unbekannt",
      reason: unclear ? `${unclear.platform}: ${unclear.status} – Ergebnis prüfen, kein automatischer zweiter Versuch` : published.length ? "zuletzt veröffentlicht" : "noch keine Veröffentlichung protokolliert",
      source: ["publication_requests", "instagram_image_posts"], lastOkAt: published[0]?.at ?? null,
      current: unclear ? { contentId: unclear.externalId, status: `${unclear.platform}: ${unclear.status}`, at: unclear.at, blocker: "Veröffentlichung unklar oder fehlgeschlagen" } : null,
      next: unclear ? { action: "auf der Plattform nachsehen, ob der Post existiert", owner: "Betreiber" } : null,
      publications,
    });
  }) ?? unreadable("publication", "Veröffentlichung", ["publication_requests", "instagram_image_posts"]);

  const results = await section(handle, async sql => {
    const since = new Date(now.getTime() - WEEK_MS).toISOString();
    const clicks = await first(sql, "SELECT count(*)::int AS n, max(clicked_at) AS last FROM landing_clicks WHERE clicked_at > $1::timestamptz", [since]);
    const observed = await first(sql, "SELECT count(*)::int AS n FROM performance_observations");
    return station("results", "Ergebnisse", {
      state: Number(clicks?.n ?? 0) > 0 ? "belegt" : "unbekannt",
      reason: "nur Klicks auf der eigenen Landingpage werden gemessen; Reichweite und Provisionen werden nicht importiert",
      source: ["landing_clicks", "performance_observations"], lastOkAt: at(clicks?.last), current: null,
      next: { action: "Provisionen/Reichweite liegen nur in Amazon PartnerNet und Meta – bei Bedarf manuell nachtragen", owner: "Betreiber" },
      metrics: [
        { label: "Klicks Landingpage (7 Tage)", value: Number(clicks?.n ?? 0), basis: "landing_clicks" },
        { label: "Reichweite", value: null, basis: "nicht erfasst" },
        { label: "Provisionen", value: null, basis: "nicht importiert" },
        { label: "manuelle Ergebnis-Einträge", value: Number(observed?.n ?? 0), basis: "performance_observations" },
      ],
    });
  }) ?? unreadable("results", "Ergebnisse", ["landing_clicks"]);

  return { id: "affiliate", label: "Affiliate-Bildpost", plain: "Produkt → Bildpost auf Facebook/Instagram (bestehender Weg, läuft per Cron zweimal täglich)",
    stations: [topic, draft, media, approvals, publication, results] };
}

async function readTopic(handle: Readable, switches: PipelineSwitches, caps: Map<string, ServiceCapability>): Promise<Track> {
  const pipelineOff = !switches.topicPipeline;
  const topic = await section(handle, async sql => {
    const last = await first(sql, "SELECT outcome, failure, selected_topic_id, created_at FROM topic_runs ORDER BY created_at DESC LIMIT 1");
    const ok = await first(sql, "SELECT max(created_at) AS last FROM topic_runs WHERE outcome IN ('success','degraded','offline_fallback')");
    const failed = last?.outcome === "failed";
    return station("topic", "Thema", {
      state: pipelineOff ? "aus" : !last ? "unbekannt" : failed ? "blockiert" : "belegt",
      reason: pipelineOff ? "Themen-Pipeline aus (TOPIC_PIPELINE_ENABLED)" : !last ? "noch kein Themenlauf" : `letzter Themenlauf: ${String(last.outcome)}${failed && last.failure ? ` (${text(last.failure, 80)})` : ""}`,
      source: ["topic_runs"], lastOkAt: at(ok?.last),
      current: last ? { contentId: last.selected_topic_id ? String(last.selected_topic_id) : null, status: String(last.outcome), at: at(last.created_at), blocker: failed ? text(last.failure, 120) : null } : null,
      next: failed ? { action: "Fehlerursache prüfen", owner: "Entwicklung" } : null,
    });
  }) ?? unreadable("topic", "Thema", ["topic_runs"]);

  const draft = await section(handle, async sql => {
    const last = await first(sql, `SELECT content_id, stage, delivery, last_error, updated_at, copy->>'origin' AS origin, ${deliveryOf("t.proposal_message_id")} AS proposal_delivery
      FROM topic_contents t ORDER BY updated_at DESC LIMIT 1`);
    const ok = await first(sql, "SELECT max(created_at) AS last FROM topic_contents");
    const held = last?.delivery === "awaiting_window";
    const unclear = last?.delivery === "unknown";
    const error = last?.last_error && last.last_error !== "dry_run" ? text(last.last_error, 120) : null;
    return station("draft", "Entwurf", {
      state: !last ? pipelineOff ? "aus" : "unbekannt" : held ? "wartet_betreiber" : unclear || error ? "blockiert" : "belegt",
      reason: !last ? "noch kein Themenentwurf" : held ? "Vorschlag gehalten: 24-h-Fenster geschlossen" : unclear ? "Zustellung des Vorschlags unklar" : error ? `Fehler: ${error}`
        : `Stufe ${String(last.stage)}${last.origin ? `, Text: ${String(last.origin)}` : ""}`,
      source: ["topic_contents"], lastOkAt: at(ok?.last),
      current: last ? { contentId: String(last.content_id), status: `${String(last.stage)}${last.proposal_delivery ? `, Vorschlag ${DELIVERY_LABEL[String(last.proposal_delivery)] ?? String(last.proposal_delivery)}` : ""}`,
        at: at(last.updated_at), blocker: held ? "wartet auf deine nächste WhatsApp-Nachricht" : unclear ? "Zustellung unklar" : error } : null,
      next: held ? { action: "kurze WhatsApp-Nachricht senden – der Vorschlag wird dann nachgeliefert", owner: "Betreiber" }
        : error ? { action: "Fehler prüfen", owner: "Entwicklung" } : null,
    });
  }) ?? unreadable("draft", "Entwurf", ["topic_contents"]);

  const runway = caps.get("runway"), heygen = caps.get("heygen");
  const videoProvider = runway?.can.produce ? "Runway" : heygen?.can.produce ? "HeyGen" : null;
  const media = await section(handle, async sql => {
    const last = await first(sql, "SELECT content_id, kind, provider, status, error_category, updated_at FROM visual_jobs ORDER BY updated_at DESC LIMIT 1");
    const ok = await first(sql, "SELECT max(updated_at) AS last FROM visual_jobs WHERE status='succeeded'");
    const failed = last?.status === "failed";
    const videoNote = !switches.topicDailyVideo ? "Themenvideo aus (TOPIC_DAILY_VIDEO)" : videoProvider ? `Videoanbieter konfiguriert: ${videoProvider} (konfiguriert ≠ geprüft)`
      : "kein Videoanbieter freigeschaltet (Runway: TOPIC_STANDARD_VIDEO_PROVIDER + TOPIC_RUNWAY_MONTHLY_VIDEO_LIMIT; HeyGen: HEYGEN_ENABLED + Avatar/Stimme/Limit)";
    return station("media", "Bild/Video", {
      state: failed ? "blockiert" : last?.status === "succeeded" ? "belegt" : pipelineOff ? "aus" : "unbekannt",
      reason: `${last ? `letzter Medienauftrag: ${String(last.kind)} über ${String(last.provider)} – ${String(last.status)}${failed && last.error_category ? ` (${text(last.error_category, 60)})` : ""}` : "noch kein Medienauftrag"}. ${videoNote}`,
      source: ["visual_jobs", "Konfiguration (nur Namen)"], lastOkAt: at(ok?.last),
      current: last ? { contentId: String(last.content_id), status: `${String(last.kind)}: ${String(last.status)}`, at: at(last.updated_at), blocker: failed ? text(last.error_category, 80) : null } : null,
      next: switches.topicDailyVideo && !videoProvider ? { action: "Videoanbieter und Monatslimit festlegen (Kostenentscheidung)", owner: "Betreiber" } : failed ? { action: "Fehlerklasse prüfen", owner: "Entwicklung" } : null,
    });
  }) ?? unreadable("media", "Bild/Video", ["visual_jobs"]);

  const approvals = await section(handle, async sql => {
    const waiting = await first(sql, `SELECT content_id, stage, updated_at, cost_message_id, ${deliveryOf("t.proposal_message_id")} AS proposal_delivery
      FROM topic_contents t WHERE stage IN ('proposed','awaiting_publish_approval') AND (proposal_message_id IS NOT NULL OR stage='awaiting_publish_approval')
      ORDER BY updated_at DESC LIMIT 1`);
    const approved = await first(sql, `SELECT greatest((SELECT max(decided_at) FROM publish_approvals WHERE status='approved'),
      (SELECT max(at) FROM topic_history WHERE status='approved')) AS last`);
    const kind = waiting?.stage === "awaiting_publish_approval" ? "Veröffentlichungsfreigabe" : "Inhaltsfreigabe";
    return station("approvals", "WhatsApp-Freigaben", {
      state: waiting ? "wartet_betreiber" : approved?.last ? "belegt" : pipelineOff ? "aus" : "unbekannt",
      reason: waiting ? `${kind} offen${waiting.proposal_delivery ? ` – Vorschlag ${DELIVERY_LABEL[String(waiting.proposal_delivery)] ?? String(waiting.proposal_delivery)}` : ""}` : approved?.last ? "keine offene Freigabe" : "noch keine Themenfreigabe erteilt",
      source: ["topic_contents", "publish_approvals", "topic_history", "whatsapp_delivery_statuses"], lastOkAt: at(approved?.last),
      current: waiting ? { contentId: String(waiting.content_id), status: kind, at: at(waiting.updated_at), blocker: null } : null,
      next: waiting ? { action: `mit „Freigeben“ auf genau die ${kind}snachricht antworten – oder ablehnen/ändern`, owner: "Betreiber" } : null,
    });
  }) ?? unreadable("approvals", "WhatsApp-Freigaben", ["topic_contents", "publish_approvals"]);

  const publication = await section(handle, async sql => {
    const rows = (await sql.query(`SELECT content_id, platform, status, reason, external_id, updated_at FROM publish_attempts WHERE origin='topic_pipeline'
      ORDER BY updated_at DESC LIMIT 5`)).rows as Row[];
    const publications: Publication[] = rows.map(row => ({ platform: String(row.platform), status: String(row.status), externalId: row.external_id ? String(row.external_id) : null, url: null, at: at(row.updated_at) }));
    const published = publications.find(item => item.status === "published");
    const last = rows[0];
    const bad = last && ["failed", "unknown", "blocked"].includes(String(last.status));
    const platforms = ["facebook", "instagram", "youtube"].map(id => caps.get(id)).filter((item): item is ServiceCapability => !!item);
    const config = platforms.map(item => `${item.label}: ${item.reason}`).join(" · ");
    return station("publication", "Veröffentlichung", {
      state: !switches.livePublishing ? "aus" : bad ? "blockiert" : published ? "belegt" : "unbekannt",
      reason: !switches.livePublishing ? `Live-Veröffentlichung aus (TOPIC_LIVE_PUBLISHING) – nur Dry-Run. ${config}` : bad ? `${String(last.platform)}: ${String(last.status)}${last.reason ? ` (${text(last.reason, 80)})` : ""}` : config,
      source: ["publish_attempts", "Konfiguration (nur Namen)"], lastOkAt: published?.at ?? null,
      current: last ? { contentId: String(last.content_id), status: `${String(last.platform)}: ${String(last.status)}`, at: at(last.updated_at), blocker: bad ? text(last.reason, 120) : null } : null,
      next: !switches.livePublishing ? { action: "Kanäle festlegen (TOPIC_PLATFORMS) und Live-Veröffentlichung freigeben – Betreiberentscheidung", owner: "Betreiber" } : null,
      publications,
    });
  }) ?? unreadable("publication", "Veröffentlichung", ["publish_attempts"]);

  const results = station("results", "Ergebnisse", { state: "unbekannt", reason: "für Themenbeiträge werden noch keine Ergebnisse erfasst", source: ["nicht erfasst"], lastOkAt: null, current: null, next: null,
    metrics: [{ label: "Reichweite", value: null, basis: "nicht erfasst" }, { label: "Interaktionen", value: null, basis: "nicht erfasst" }] });
  return { id: "topic", label: "Themenbeitrag", plain: "Thema → Bild/Video → Facebook/Instagram/YouTube (neuer Weg, Schalter einzeln)",
    stations: [topic, draft, media, approvals, publication, results] };
}
