import type { Database, Sql } from "../memory/db";
import { BUILT_IN_CATEGORIES, keyFor, labelFor, nameTokens, normalizedName, resolveCategory, validNewName, withCustom, type Category, type Registry } from "./taxonomy";

// Registry = built-in categories (code) + operator-created ones (content_categories).
export async function loadRegistry(db: Sql): Promise<Registry> {
  const rows = await db.query("SELECT key,display_name FROM content_categories ORDER BY created_at");
  return withCustom(rows.rows.map(row => ({ key: String(row.key), label: String(row.display_name) })));
}
export async function categoryLabel(db: Sql, key: string) { return labelFor(key, await loadRegistry(db)); }

// Only called for an explicit operator instruction. Returns the existing category if the name is a variant of one.
export async function createCategory(db: Database, name: string, messageId: string | null): Promise<{ category: Category; created: boolean } | { error: "invalid_name" }> {
  const label = validNewName(name);
  if (!label) return { error: "invalid_name" };
  return db.transaction(async sql => {
    await sql.query("SELECT pg_advisory_xact_lock($1)", [83624003]);
    const registry = await loadRegistry(sql);
    const known = resolveCategory(label, registry);
    if (known.kind === "match") return { category: known.category, created: false };
    let key = keyFor(label);
    if (registry.some(item => item.key === key)) key = `${key}_${nameTokens(label).length}`.slice(0, 39);
    if (registry.some(item => item.key === key)) return { error: "invalid_name" as const };
    await sql.query("INSERT INTO content_categories(key,display_name,normalized,created_from_message_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [key, label, normalizedName(label), messageId]);
    const stored = await sql.query("SELECT key,display_name FROM content_categories WHERE normalized=$1", [normalizedName(label)]);
    return { category: { key: String(stored.rows[0].key), label: String(stored.rows[0].display_name), custom: true }, created: !!stored.rows[0] && stored.rows[0].key === key };
  });
}

export class CategoryChangeError extends Error {}
// Changes the category of exactly one content record, in place. Product, ASIN, affiliate link, image and
// caption are never touched. The open content approval is withdrawn so a fresh one has to be sent and given.
export async function setJobCategory(db: Database, jobId: string, key: string) {
  return db.transaction(async sql => {
    const stored = await sql.query("SELECT snapshot,status,category FROM content_jobs WHERE id=$1 FOR UPDATE", [jobId]);
    const row = stored.rows[0];
    if (!row) throw new CategoryChangeError("job_missing");
    const draft = await sql.query("SELECT 1 FROM daily_drafts WHERE job_id=$1 AND status IN ('awaiting_approval','changes_requested')", [jobId]);
    if (row.status !== "awaiting_approval" || !draft.rows.length) throw new CategoryChangeError("not_open_for_content_approval");
    const snapshot = row.snapshot as { opportunity: { category?: string }; events: { sequence: number }[]; updatedAt: string };
    const previous = String(row.category);
    if (previous === key) return { changed: false as const, previous };
    const now = new Date().toISOString();
    const sequence = (snapshot.events.at(-1)?.sequence ?? 0) + 1;
    const registry = await loadRegistry(sql);
    const event = { sequence, at: now, agent: "orchestrator", kind: "decision",
      message: `Kategorie von „${labelFor(previous, registry)}“ auf „${labelFor(key, registry)}“ geändert; erneute Inhaltsfreigabe erforderlich.`,
      data: { kind: "category_change", from: previous, to: key } };
    snapshot.opportunity.category = key; snapshot.updatedAt = now; snapshot.events.push(event);
    await sql.query("UPDATE content_jobs SET category=$2,opportunity=jsonb_set(opportunity,'{category}',to_jsonb($2::text)),snapshot=$3,event_sequence=$4,updated_at=$5 WHERE id=$1",
      [jobId, key, JSON.stringify(snapshot), sequence, now]);
    await sql.query("INSERT INTO job_events(job_id,sequence,agent,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6)", [jobId, sequence, event.agent, event.kind, now, JSON.stringify(event)]);
    await sql.query("UPDATE daily_drafts SET status='awaiting_approval',whatsapp_message_id=NULL,whatsapp_send_attempted_at=NULL,updated_at=now() WHERE job_id=$1", [jobId]);
    await sql.query("UPDATE content_approval_requests SET status='rejected',feedback='category_changed',decided_at=now() WHERE job_id=$1 AND status='pending'", [jobId]);
    return { changed: true as const, previous };
  });
}
export { BUILT_IN_CATEGORIES };
