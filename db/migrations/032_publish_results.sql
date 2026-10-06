-- Per-platform publish results: remote ids of every created object (containers, uploads, posts), final link,
-- and an explicit 'processing' state for platforms that publish asynchronously (TikTok, YouTube, Instagram reels).
ALTER TABLE publish_attempts ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE publish_attempts ADD COLUMN IF NOT EXISTS remote_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE publish_attempts DROP CONSTRAINT IF EXISTS publish_attempts_status_check;
ALTER TABLE publish_attempts ADD CONSTRAINT publish_attempts_status_check CHECK (status IN ('blocked','claimed','processing','published','failed','unknown'));
DROP INDEX IF EXISTS publish_attempts_one_claim;
-- At most one live claim per content version and platform (processing included): no double posting.
CREATE UNIQUE INDEX IF NOT EXISTS publish_attempts_one_claim ON publish_attempts(content_id, version, platform) WHERE status IN ('claimed','processing','published','unknown');
