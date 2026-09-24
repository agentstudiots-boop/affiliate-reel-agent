-- Durable one-attempt gate. An unknown outcome is intentionally not retried.
CREATE TABLE IF NOT EXISTS original_visual_attempts (
  job_id uuid NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  provider text NOT NULL CHECK (provider = 'openai'),
  model text NOT NULL,
  status text NOT NULL DEFAULT 'attempted' CHECK (status IN ('attempted','media_ready')),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  media_ready_at timestamptz,
  sha256 text,
  image_url text,
  usage jsonb,
  PRIMARY KEY (job_id,content_hash)
);
