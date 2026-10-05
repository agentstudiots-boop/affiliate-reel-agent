-- One row per topic content piece moving through proposal → production → publish approval → publishing.
-- Publishing itself is controlled solely by publish_approvals (migration 029); this table holds the work state.
CREATE TABLE IF NOT EXISTS topic_contents (
  content_id text PRIMARY KEY,
  run_id uuid,
  topic_id text NOT NULL,
  category text NOT NULL DEFAULT 'topic' CHECK (category IN ('topic','affiliate')),
  stage text NOT NULL CHECK (stage IN ('proposed','producing','in_production','awaiting_publish_approval','publishing','published','partially_published','not_published','rejected','discarded','failed')),
  format text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  candidate jsonb NOT NULL,
  decision jsonb NOT NULL,
  override jsonb NOT NULL DEFAULT '{}'::jsonb,
  copy jsonb NOT NULL,
  production jsonb,
  master jsonb,
  product jsonb NOT NULL DEFAULT '{"status":"none"}'::jsonb,
  proposal_message_id text UNIQUE,
  product_message_id text UNIQUE,
  model_calls integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS topic_contents_recent ON topic_contents(updated_at DESC);
