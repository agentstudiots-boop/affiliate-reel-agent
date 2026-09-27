-- Human feedback becomes planning evidence only after the revised content is approved.
CREATE TABLE IF NOT EXISTS approved_editorial_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_wa_id text NOT NULL,
  source_message_id text NOT NULL REFERENCES whatsapp_events(message_id),
  confirmation_message_id text NOT NULL REFERENCES whatsapp_events(message_id),
  feedback text NOT NULL CHECK(length(feedback) BETWEEN 1 AND 1000),
  format text NOT NULL CHECK(format IN ('image','video','text')),
  product_context jsonb NOT NULL,
  content_id uuid NOT NULL REFERENCES content_jobs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_message_id,confirmation_message_id)
);
CREATE INDEX IF NOT EXISTS approved_editorial_feedback_lookup ON approved_editorial_feedback(operator_wa_id,created_at DESC);
