-- User-defined categories only. Built-in categories live in code (lib/content/taxonomy.ts); every content
-- record keeps its category key in content_jobs.category, which stays the single source of truth.
-- Rows are created exclusively on an explicit operator instruction.
CREATE TABLE IF NOT EXISTS content_categories (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 30),
  normalized text NOT NULL UNIQUE,
  created_from_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
