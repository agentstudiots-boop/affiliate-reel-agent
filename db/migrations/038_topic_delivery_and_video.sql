-- Topic pipeline in production (additive only).
-- 1) WhatsApp 24 h service window: a proposal created while the window is closed is held (delivery='awaiting_window')
--    and sent once with the operator's next message; an optional approved template only notifies.
-- 2) Daily topic video: one regular video proposal per Berlin calendar day (topic_video_days), a production briefing and
--    a separate cost approval (cost_message_id) between content approval and any paid render.
ALTER TABLE topic_contents ADD COLUMN IF NOT EXISTS delivery text;
ALTER TABLE topic_contents ADD COLUMN IF NOT EXISTS notification_message_id text;
ALTER TABLE topic_contents ADD COLUMN IF NOT EXISTS video jsonb;
ALTER TABLE topic_contents ADD COLUMN IF NOT EXISTS cost_message_id text;
CREATE UNIQUE INDEX IF NOT EXISTS topic_contents_cost_message ON topic_contents(cost_message_id) WHERE cost_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS topic_contents_delivery ON topic_contents(delivery, updated_at DESC) WHERE delivery IS NOT NULL;

CREATE TABLE IF NOT EXISTS topic_video_days (
  day date PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('claimed','proposed','no_topic','failed')),
  content_id text,
  attempts integer NOT NULL DEFAULT 1,
  reason text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
