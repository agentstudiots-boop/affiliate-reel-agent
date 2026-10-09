-- Image quality pipeline: every paid image generation of a content job, its validated prompt, provider job id, quality
-- result and estimated cost. Budget = paid attempts per job; provider refusals before acceptance are not paid.
CREATE TABLE IF NOT EXISTS image_generation_attempts (
  job_id uuid NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  attempt_no int NOT NULL CHECK (attempt_no >= 1),
  content_hash text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_sha256 text NOT NULL,
  prompt_corrected boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('claimed','accepted','generated','rejected_by_provider','unclear','failed')),
  prediction_id text,
  image_url text,
  sha256 text,
  quality_status text CHECK (quality_status IS NULL OR quality_status IN ('passed','failed','uncertain','manual_override','skipped')),
  quality jsonb,
  cost jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, attempt_no)
);

-- WhatsApp notices about a stopped image job; replies to exactly these messages are the operator's manual decision.
CREATE TABLE IF NOT EXISTS image_quality_notices (
  message_id text PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  reason text NOT NULL,
  attempt_no int,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Manual decisions: one more paid attempt (optionally with a change wish) or sending an uncertain image for human review.
CREATE TABLE IF NOT EXISTS image_generation_grants (
  message_id text PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('new_attempt','send_unchecked')),
  change_instruction text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS image_generation_grants_job ON image_generation_grants(job_id);

-- Learning memory of the image quality system (no image data, only references and structured findings). Each assessed
-- attempt is one experience; human decisions are joined from publication_requests by image URL when lessons are built.
CREATE TABLE IF NOT EXISTS image_quality_experiences (
  job_id uuid NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  attempt_no int NOT NULL,
  category text NOT NULL,
  product_type text NOT NULL,
  content_format text NOT NULL,
  spec jsonb NOT NULL,
  prompt_version text NOT NULL,
  prompt_sha256 text NOT NULL,
  image_url text,
  outcome text NOT NULL CHECK (outcome IN ('passed','failed','uncertain','technical')),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  correction jsonb,
  correction_result text CHECK (correction_result IS NULL OR correction_result IN ('success','failure')),
  generations int NOT NULL,
  cost_usd numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, attempt_no)
);
CREATE INDEX IF NOT EXISTS image_quality_experiences_lookup ON image_quality_experiences(product_type, category, created_at DESC);
