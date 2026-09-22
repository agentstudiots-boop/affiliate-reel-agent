import { Pool } from "pg";
export type Sql = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  exec: (sql: string) => Promise<unknown>;
};
export type Database = Sql & { transaction: <T>(fn: (sql: Sql) => Promise<T>) => Promise<T> };
let pool: Pool | undefined;
export function databaseConfigured() { return !!process.env.DATABASE_URL && !!process.env.CONTENT_STUDIO_PASSWORD; }
export function getDatabase(): Database {
  if (!process.env.DATABASE_URL) throw new Error("Postgres ist nicht eingerichtet.");
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
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
