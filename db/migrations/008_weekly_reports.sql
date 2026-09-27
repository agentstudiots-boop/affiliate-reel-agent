CREATE TABLE IF NOT EXISTS weekly_reports (
  week_start date PRIMARY KEY,
  week_end date NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed','ready','notification_sent','sent','delivery_unknown','failed')),
  report_text text NOT NULL DEFAULT '',
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  whatsapp_send_attempted_at timestamptz,
  whatsapp_message_id text UNIQUE,
  notification_send_attempted_at timestamptz,
  notification_message_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (week_end > week_start)
);

ALTER TABLE whatsapp_events DROP CONSTRAINT IF EXISTS whatsapp_events_intent_check;
ALTER TABLE whatsapp_events ADD CONSTRAINT whatsapp_events_intent_check
  CHECK (intent IN ('approve','reject','changes_requested','notification_reply','weekly_report_reply'));
