-- One bounded conversational response per inbound operator message.
-- Keep the claim even when an outbound result is unknown: Meta POSTs are not retried.
CREATE TABLE IF NOT EXISTS whatsapp_chat_turns (
  message_id text PRIMARY KEY REFERENCES whatsapp_events(message_id),
  wa_id text NOT NULL,
  operator_text text NOT NULL,
  reply_text text,
  status text NOT NULL CHECK (status IN ('claimed','ready','sent','failed')),
  send_attempted_at timestamptz,
  whatsapp_message_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_chat_recent ON whatsapp_chat_turns(wa_id,created_at DESC);

-- Clear historical terminal daily inbox entries once on upgrade. Retain
-- content_jobs, events and provider/approval evidence for cooldown and audit.
-- Today's slots and any still actionable approval remain untouched.
DELETE FROM daily_drafts
WHERE day < (now() AT TIME ZONE 'Europe/Berlin')::date
  AND status IN ('rejected','needs_input','failed')
  AND NOT EXISTS (SELECT 1 FROM content_approval_requests a
    WHERE a.job_id=daily_drafts.job_id AND a.status='pending')
  AND NOT EXISTS (SELECT 1 FROM publication_requests p
    WHERE p.job_id=daily_drafts.job_id AND p.status IN ('preparing','pending','approved','publishing','unknown'));
