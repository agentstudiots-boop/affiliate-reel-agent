-- Per-platform publish results: remote ids of every created object (containers, uploads, posts), final link,
-- and an explicit 'processing' state for platforms that publish asynchronously (TikTok, YouTube, Instagram reels).
ALTER TABLE publish_attempts ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE publish_attempts ADD COLUMN IF NOT EXISTS remote_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE publish_attempts DROP CONSTRAINT IF EXISTS publish_attempts_status_check;
ALTER TABLE publish_attempts ADD CONSTRAINT publish_attempts_status_check CHECK (status IN ('blocked','claimed','processing','published','failed','unknown'));
DROP INDEX IF EXISTS publish_attempts_one_claim;
-- At most one live claim per content version and platform (processing included): no double posting.
CREATE UNIQUE INDEX IF NOT EXISTS publish_attempts_one_claim ON publish_attempts(content_id, version, platform) WHERE status IN ('claimed','processing','published','unknown');

-- Idempotency/audit for free WhatsApp messages the topic pipeline handled without a quoted message
-- (semantically assigned to a topic draft). Stores ids, the action and the target content id only.
CREATE TABLE IF NOT EXISTS topic_inbound (
  message_id text PRIMARY KEY,
  content_id text,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Lease for the topic cron: at most one run at a time, even if invocations overlap (slow run, manual call).
-- A crashed holder's lease expires automatically.
CREATE TABLE IF NOT EXISTS topic_cron_lease (
  id integer PRIMARY KEY CHECK (id = 1),
  holder text,
  expires_at timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z'
);
INSERT INTO topic_cron_lease(id) VALUES (1) ON CONFLICT DO NOTHING;

-- Earlier proposal / product-suggestion messages of a topic draft: a reply to them is answered as outdated
-- (nothing changed) and never reaches another pipeline.
ALTER TABLE topic_contents ADD COLUMN IF NOT EXISTS previous_message_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
