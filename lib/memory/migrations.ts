import fs from "node:fs";
import path from "node:path";
import { getDatabase, type Database } from "./db";

const migrationNames = ["001_memory.sql", "002_production_gates.sql", "003_faceless_so.sql", "004_daily_drafts.sql", "005_publication_gate.sql", "006_daily_notification.sql", "007_publication_revisions.sql", "008_weekly_reports.sql", "009_original_visual_attempts.sql", "010_replicate_visual_provider.sql", "011_instagram_reel_publications.sql", "012_whatsapp_instructions.sql", "013_operator_language_examples.sql", "014_content_approval_requests.sql"] as const;

export type MigrationResult = {
  applied: string[];
  alreadyApplied: string[];
};

function loadMigration(name: string) {
  if (!migrationNames.includes(name as (typeof migrationNames)[number])) {
    throw new Error("Unbekannte Migration.");
  }
  return fs.readFileSync(path.join(process.cwd(), "db", "migrations", name), "utf8");
}

export async function applyMigrations(
  database: Database = getDatabase(),
  loader: (name: string) => string = loadMigration,
): Promise<MigrationResult> {
  return database.transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock($1)", [83624001]);
    await sql.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const result: MigrationResult = { applied: [], alreadyApplied: [] };
    for (const name of migrationNames) {
      const existing = await sql.query("SELECT name FROM schema_migrations WHERE name=$1", [name]);
      if (existing.rows.length) {
        result.alreadyApplied.push(name);
        continue;
      }
      await sql.exec(loader(name));
      await sql.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      result.applied.push(name);
    }
    return result;
  });
}
