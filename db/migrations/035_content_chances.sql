-- Trendsetter: shared research results (content chances) for the affiliate and the topic pipeline, plus Jarvis' routing
-- decisions per pipeline (duplicate control and time locks). Additive only.

CREATE TABLE IF NOT EXISTS content_chances (
  chance_id text PRIMARY KEY CHECK (chance_id ~ '^cc_[a-f0-9]{16}$'),
  concept_key text NOT NULL,
  title text NOT NULL,
  hook text NOT NULL DEFAULT '',
  origins text[] NOT NULL DEFAULT '{}',
  origin_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  detected_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  scores jsonb NOT NULL,
  suitability integer NOT NULL CHECK (suitability BETWEEN 0 AND 100),
  recommendation text NOT NULL CHECK (recommendation IN ('affiliate','topic','both','none')),
  recommendation_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  affiliate_angle text,
  topic_angle text,
  product_idea text,
  sensitive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_chances_recent ON content_chances(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS content_chance_routes (
  id uuid PRIMARY KEY,
  chance_id text NOT NULL REFERENCES content_chances(chance_id) ON DELETE CASCADE,
  pipeline text NOT NULL CHECK (pipeline IN ('affiliate','topic')),
  status text NOT NULL CHECK (status IN ('routed','consumed','published','rejected','expired')),
  priority integer NOT NULL DEFAULT 0,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- At most one open route per chance and pipeline: no double processing through repeated cron calls.
CREATE UNIQUE INDEX IF NOT EXISTS content_chance_routes_open ON content_chance_routes(chance_id, pipeline) WHERE status IN ('routed','consumed');
CREATE INDEX IF NOT EXISTS content_chance_routes_recent ON content_chance_routes(created_at DESC);
