CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  name text NOT NULL,
  source_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS content_jobs (
  id uuid PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id),
  category text NOT NULL,
  use_case_key text NOT NULL,
  goal text NOT NULL,
  target_platform text NOT NULL,
  trend text NOT NULL,
  opportunity jsonb NOT NULL,
  status text NOT NULL,
  content_type text CHECK (content_type IN ('video','image','text')),
  platform_plan text,
  creative jsonb,
  decision jsonb,
  decision_reason text,
  agents text[] NOT NULL DEFAULT '{}',
  snapshot jsonb NOT NULL,
  event_sequence integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS content_similarity ON content_jobs(category,use_case_key,goal,created_at DESC);
CREATE TABLE IF NOT EXISTS job_events (
  job_id uuid NOT NULL REFERENCES content_jobs(id),
  sequence integer NOT NULL,
  agent text NOT NULL,
  kind text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(job_id,sequence)
);
CREATE TABLE IF NOT EXISTS publications (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES content_jobs(id),
  platform text NOT NULL CHECK (platform IN ('facebook','instagram')),
  status text NOT NULL CHECK (status IN ('draft','published','archived')),
  url text,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,platform),
  CHECK (status = 'draft' OR (url IS NOT NULL AND published_at IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS performance_observations (
  id uuid PRIMARY KEY,
  publication_id uuid NOT NULL REFERENCES publications(id),
  revision integer NOT NULL CHECK(revision > 0),
  observed_at timestamptz NOT NULL DEFAULT now(),
  window_days integer NOT NULL CHECK(window_days IN (14,30,60)),
  finalized boolean NOT NULL DEFAULT false,
  clicks integer NOT NULL CHECK(clicks >= 0),
  conversions integer NOT NULL CHECK(conversions >= 0),
  affiliate_revenue_cents bigint NOT NULL CHECK(affiliate_revenue_cents >= 0),
  production_cost_cents bigint CHECK(production_cost_cents >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
  profit_cents bigint GENERATED ALWAYS AS (affiliate_revenue_cents-production_cost_cents) STORED,
  roi numeric GENERATED ALWAYS AS ((affiliate_revenue_cents-production_cost_cents)::numeric/NULLIF(production_cost_cents,0)) STORED,
  source text NOT NULL,
  learning text NOT NULL DEFAULT '',
  UNIQUE(publication_id,revision)
);
CREATE INDEX IF NOT EXISTS observation_latest ON performance_observations(publication_id,revision DESC);
