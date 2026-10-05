-- Topic scout runs, scored candidates with the Jarvis gate verdict, and topic history for cooldowns.
-- Stores titles, public source URLs and scores only: no secrets, no personal data.
CREATE TABLE IF NOT EXISTS topic_runs (
  id uuid PRIMARY KEY,
  slot_key text UNIQUE,
  started_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success','degraded','offline_fallback','no_candidates','failed')),
  source_health jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidate_count integer NOT NULL DEFAULT 0,
  selected_topic_id text,
  dropped jsonb NOT NULL DEFAULT '[]'::jsonb,
  duration_ms integer NOT NULL DEFAULT 0,
  failure text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS topic_runs_recent ON topic_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS topic_candidates (
  run_id uuid NOT NULL REFERENCES topic_runs(id) ON DELETE CASCADE,
  topic_id text NOT NULL,
  trend_type text NOT NULL,
  title text NOT NULL,
  relevance_score integer NOT NULL,
  risk_score integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accept','revise','request_variant','reject')),
  candidate jsonb NOT NULL,
  gate jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, topic_id)
);
CREATE INDEX IF NOT EXISTS topic_candidates_by_topic ON topic_candidates(topic_id, created_at DESC);

CREATE TABLE IF NOT EXISTS topic_history (
  id bigserial PRIMARY KEY,
  topic_id text NOT NULL,
  concept_key text NOT NULL,
  title text NOT NULL,
  hook text NOT NULL,
  audience_problem text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('proposed','approved','published','rejected','discarded')),
  -- Idempotency: one history row per (topic, status, origin), e.g. the run or the approval message.
  origin text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_id, status, origin)
);
CREATE INDEX IF NOT EXISTS topic_history_recent ON topic_history(at DESC);
