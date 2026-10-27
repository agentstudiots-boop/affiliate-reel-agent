import { Pool } from "pg";
import { assertEffectAllowed } from "../security/runtime-guard";
export type Sql = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  exec: (sql: string) => Promise<unknown>;
};
export type Database = Sql & { transaction: <T>(fn: (sql: Sql) => Promise<T>) => Promise<T> };
let pool: Pool | undefined;
// Neon connection strings carry sslmode=require. pg already treats prefer/require/verify-ca as verify-full and warns on
// every cold start; stating verify-full explicitly keeps the same (strict) behaviour without the warning and without
// changing the secret. scripts/connection-string.cjs does the same for the operator scripts.
export function strictSslConnectionString(url: string) {
  try {
    const parsed = new URL(url);
    if (["prefer", "require", "verify-ca"].includes(parsed.searchParams.get("sslmode") ?? "")) parsed.searchParams.set("sslmode", "verify-full");
    return parsed.toString();
  } catch { return url; }
}
export function databaseConfigured() { return !!process.env.DATABASE_URL && !!process.env.CONTENT_STUDIO_PASSWORD; }
export function getDatabase(): Database {
  // Preview deployments may carry the production DATABASE_URL: no access unless a separate sandbox is declared.
  assertEffectAllowed("database");
  if (!process.env.DATABASE_URL) throw new Error("Postgres ist nicht eingerichtet.");
  pool ??= new Pool({ connectionString: strictSslConnectionString(process.env.DATABASE_URL), max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
  const current = pool;
  return {
    query: (sql, values) => current.query(sql, values),
    exec: (sql) => current.query(sql),
    async transaction(fn) {
      const client = await current.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({ query: (sql, values) => client.query(sql, values), exec: (sql) => client.query(sql) });
        await client.query("COMMIT");
        return result;
      }
      catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    },
  };
}
