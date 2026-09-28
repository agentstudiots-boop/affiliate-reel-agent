CREATE TABLE IF NOT EXISTS product_selection_locks (
  key text PRIMARY KEY,
  job_id uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS product_selection_locks_expiry_idx ON product_selection_locks(expires_at);
