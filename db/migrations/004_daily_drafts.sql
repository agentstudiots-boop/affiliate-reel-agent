CREATE TABLE IF NOT EXISTS daily_drafts (
  day date PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('claimed','planning','awaiting_approval','needs_input','failed')),
  scout_report jsonb,
  whatsapp_send_attempted_at timestamptz,
  whatsapp_message_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
