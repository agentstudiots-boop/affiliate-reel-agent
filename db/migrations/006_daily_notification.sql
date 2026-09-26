ALTER TABLE daily_drafts ADD COLUMN IF NOT EXISTS notification_send_attempted_at timestamptz;
ALTER TABLE daily_drafts ADD COLUMN IF NOT EXISTS notification_message_id text UNIQUE;
ALTER TABLE whatsapp_events DROP CONSTRAINT IF EXISTS whatsapp_events_intent_check;
ALTER TABLE whatsapp_events ADD CONSTRAINT whatsapp_events_intent_check
  CHECK (intent IN ('approve','reject','changes_requested','notification_reply'));
