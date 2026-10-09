// In-memory Postgres (PGlite) with all migrations applied, wrapped in the Database interface of lib/memory/db.
const { PGlite } = require('@electric-sql/pglite');
const { applyMigrations } = require('../../.test-build/lib/memory/migrations');

module.exports = async function pgliteDatabase() {
  const pg = new PGlite();
  const db = {
    query: (query, values) => pg.query(query, values),
    exec: query => pg.exec(query),
    transaction: fn => pg.transaction(tx => fn({ query: (query, values) => tx.query(query, values), exec: query => tx.exec(query) })),
    close: () => pg.close(),
  };
  await applyMigrations(db);
  return db;
};
