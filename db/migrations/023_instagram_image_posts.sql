-- One Instagram feed image per approved Facebook publication. The row is claimed
-- before any Graph write; an unknown publish result is never retried automatically.
CREATE TABLE IF NOT EXISTS instagram_image_posts (
  publication_id uuid PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('claimed','container_created','processing','publishing','published','failed','unknown','skipped')),
  jpeg_url text,
  container_id text,
  media_id text,
  permalink text,
  error_phase text,
  error_detail text,
  publish_attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
