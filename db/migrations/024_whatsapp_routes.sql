-- One semantic interpretation per inbound operator message. A replayed webhook reuses it,
-- so a message is never interpreted (and paid for) twice. No secrets are stored.
CREATE TABLE IF NOT EXISTS whatsapp_routes (
  message_id text PRIMARY KEY,
  wa_id text NOT NULL,
  raw_message text NOT NULL,
  route jsonb NOT NULL,
  context_summary jsonb NOT NULL,
  action text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_routes_recent ON whatsapp_routes(wa_id,created_at DESC);
