-- Visual Content Engine: one row per generation job (image, carousel slide, video). The idempotency key is
-- derived from content id, role (e.g. slide-3) and brief fingerprint: the same slide is never generated twice,
-- a failed slide is retried alone, a started provider job is resumed instead of re-created.
CREATE TABLE IF NOT EXISTS visual_jobs (
  idempotency_key text PRIMARY KEY,
  content_id text NOT NULL,
  role text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image','avatar_video','standard_video')),
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','succeeded','failed')),
  attempts integer NOT NULL DEFAULT 1,
  provider_job_id text,
  asset jsonb,
  error_category text,
  retryable boolean NOT NULL DEFAULT false,
  brief_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS visual_jobs_by_content ON visual_jobs(content_id, created_at DESC);
CREATE INDEX IF NOT EXISTS visual_jobs_recent ON visual_jobs(kind, updated_at DESC);

-- Provider usage for budgets and quotas (HeyGen has no reliably queryable quota: local counter per month).
CREATE TABLE IF NOT EXISTS provider_usage (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  kind text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('planned','succeeded','failed')),
  month text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  units integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, idempotency_key)
);
CREATE INDEX IF NOT EXISTS provider_usage_month ON provider_usage(provider, month);
