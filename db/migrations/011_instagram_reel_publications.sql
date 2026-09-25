ALTER TABLE publication_requests DROP CONSTRAINT IF EXISTS publication_requests_platform_check;
ALTER TABLE publication_requests ADD CONSTRAINT publication_requests_platform_check
  CHECK (platform IN ('facebook','instagram'));
ALTER TABLE publication_requests DROP CONSTRAINT IF EXISTS publication_requests_status_check;
ALTER TABLE publication_requests ADD CONSTRAINT publication_requests_status_check
  CHECK (status IN ('preparing','pending','approved','changes_requested','rejected','publishing','processing','published','unknown'));
ALTER TABLE publication_requests ADD COLUMN IF NOT EXISTS video_url text;
ALTER TABLE publication_requests ADD COLUMN IF NOT EXISTS instagram_container_id text UNIQUE;
ALTER TABLE publication_requests ADD COLUMN IF NOT EXISTS instagram_media_publish_attempted_at timestamptz;
ALTER TABLE publication_requests ADD CONSTRAINT publication_requests_video_url_check
  CHECK (video_url IS NULL OR video_url ~ '^https://');
