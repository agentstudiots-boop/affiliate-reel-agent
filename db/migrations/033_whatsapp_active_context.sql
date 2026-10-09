-- Active WhatsApp conversation context: the operator's latest explicit product order and its state.
-- One row per operator; every change is also appended to whatsapp_context_log (traceable, idempotent per message).
CREATE TABLE IF NOT EXISTS whatsapp_active_context (
  wa_id text PRIMARY KEY,
  product_label text NOT NULL,
  asin text,
  search_term text,
  job_id uuid,
  status text NOT NULL CHECK (status IN ('requested','in_progress','awaiting_approval','blocked','failed')),
  reason text,
  format_wish text CHECK (format_wish IS NULL OR format_wish IN ('image','reel')),
  source_message_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_context_log (
  message_id text NOT NULL,
  action text NOT NULL,
  wa_id text NOT NULL,
  product_label text,
  job_id uuid,
  status text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, action)
);
CREATE INDEX IF NOT EXISTS whatsapp_context_log_recent ON whatsapp_context_log(wa_id, created_at DESC);
