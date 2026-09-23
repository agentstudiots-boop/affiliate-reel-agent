CREATE TABLE IF NOT EXISTS content_versions (
  id uuid PRIMARY KEY,
  job_id uuid REFERENCES content_jobs(id),
  version integer NOT NULL CHECK (version > 0),
  format text NOT NULL CHECK (format IN ('video','image','text')),
  platform text CHECK (platform IN ('facebook','instagram')),
  content jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','awaiting_approval','revision_requested','approved','rejected','published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  published_at timestamptz,
  UNIQUE(job_id,version)
);

CREATE TABLE IF NOT EXISTS capability_proposals (
  id uuid PRIMARY KEY,
  agent text NOT NULL,
  proposed_capability text NOT NULL,
  observation text NOT NULL,
  reason text NOT NULL,
  expected_benefit text NOT NULL,
  estimated_cost_cents bigint CHECK (estimated_cost_cents IS NULL OR estimated_cost_cents >= 0),
  risk text NOT NULL,
  required_external_service text,
  evidence jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'AWAITING_HUMAN_APPROVAL' CHECK (status IN ('AWAITING_HUMAN_APPROVAL','APPROVED_ONCE','APPROVED_PERMANENTLY','REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS production_requests (
  id uuid PRIMARY KEY,
  content_job_id uuid REFERENCES content_jobs(id),
  content_version_id uuid REFERENCES content_versions(id),
  product_id text REFERENCES products(id),
  provider text NOT NULL CHECK (provider IN ('faceless','runway')),
  renderer_mode text NOT NULL CHECK (renderer_mode IN ('FACELESS_STORYBOARD','FACELESS_MOTION_LITE','FACELESS_MOTION_PRO','RUNWAY')),
  renderer_reason text NOT NULL,
  decision_factors jsonb NOT NULL,
  script text NOT NULL,
  voice_id text,
  estimated_credits integer CHECK (estimated_credits IS NULL OR estimated_credits >= 0),
  actual_credits integer CHECK (actual_credits IS NULL OR actual_credits >= 0),
  estimated_cost_cents bigint CHECK (estimated_cost_cents IS NULL OR estimated_cost_cents >= 0),
  actual_cost_cents bigint CHECK (actual_cost_cents IS NULL OR actual_cost_cents >= 0),
  cost_currency text NOT NULL DEFAULT 'EUR',
  affiliate_commission jsonb,
  prior_opportunity_cost_cents bigint NOT NULL DEFAULT 0 CHECK (prior_opportunity_cost_cents >= 0),
  status text NOT NULL CHECK (status IN ('planned','awaiting_cost_approval','approved','starting','submitted','generating','rendering','transferring','completed','failed','rejected','start_unknown')),
  external_job_id text,
  external_render_id text,
  provider_asset_url text,
  blob_url text,
  blob_path text,
  error_code text,
  error_message text,
  idempotency_key uuid NOT NULL UNIQUE,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS production_provider_job ON production_requests(provider,external_job_id) WHERE external_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS production_bootstrap_success ON production_requests(provider,renderer_mode,status,completed_at);

CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('RENDER_COST','CONTENT_PUBLISH','CAPABILITY_PROPOSAL')),
  production_request_id uuid REFERENCES production_requests(id),
  content_version_id uuid REFERENCES content_versions(id),
  capability_proposal_id uuid REFERENCES capability_proposals(id),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'AWAITING_HUMAN_APPROVAL' CHECK (status IN ('AWAITING_HUMAN_APPROVAL','APPROVED','REJECTED','REVISION_REQUESTED','SUPERSEDED')),
  decision_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  decided_at timestamptz,
  CHECK (num_nonnulls(production_request_id,content_version_id,capability_proposal_id)=1)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_render_approval ON approval_requests(production_request_id) WHERE kind='RENDER_COST' AND status='AWAITING_HUMAN_APPROVAL';
CREATE UNIQUE INDEX IF NOT EXISTS one_open_content_approval ON approval_requests(content_version_id) WHERE kind='CONTENT_PUBLISH' AND status='AWAITING_HUMAN_APPROVAL';
CREATE UNIQUE INDEX IF NOT EXISTS one_open_proposal_approval ON approval_requests(capability_proposal_id) WHERE kind='CAPABILITY_PROPOSAL' AND status='AWAITING_HUMAN_APPROVAL';

CREATE TABLE IF NOT EXISTS conversation_contexts (
  id uuid PRIMARY KEY,
  sender_hash text NOT NULL,
  approval_request_id uuid NOT NULL REFERENCES approval_requests(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_conversation_per_sender ON conversation_contexts(sender_hash) WHERE status='open';

CREATE TABLE IF NOT EXISTS human_instructions (
  id uuid PRIMARY KEY,
  approval_request_id uuid NOT NULL REFERENCES approval_requests(id),
  sender_hash text NOT NULL,
  intent text NOT NULL CHECK (intent IN ('APPROVE','REJECT','REVISION_REQUEST','APPROVE_ONCE','APPROVE_PERMANENTLY','CLARIFY')),
  target text,
  instruction text NOT NULL,
  raw_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('received','ignored','processed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY(provider,event_id)
);

ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS impressions integer CHECK (impressions IS NULL OR impressions >= 0);
ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS views integer CHECK (views IS NULL OR views >= 0);
ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS watch_time_seconds bigint CHECK (watch_time_seconds IS NULL OR watch_time_seconds >= 0);
ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS completion_rate numeric CHECK (completion_rate IS NULL OR (completion_rate >= 0 AND completion_rate <= 1));
ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS ctr numeric CHECK (ctr IS NULL OR (ctr >= 0 AND ctr <= 1));
ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS orders integer CHECK (orders IS NULL OR orders >= 0);
ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS new_followers integer CHECK (new_followers IS NULL OR new_followers >= 0);
ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS follower_total integer CHECK (follower_total IS NULL OR follower_total >= 0);

CREATE TABLE IF NOT EXISTS weekly_reports (
  period_start date PRIMARY KEY,
  period_end date NOT NULL,
  data jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','sent','failed')),
  provider_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS publishing_jobs (
  id uuid PRIMARY KEY,
  content_version_id uuid NOT NULL REFERENCES content_versions(id),
  platform text NOT NULL CHECK (platform IN ('facebook','instagram')),
  status text NOT NULL CHECK (status IN ('approved','creating_container','container_created','processing','ready','publishing','fb_initialized','fb_uploading','fb_uploaded','published','failed','unknown')),
  external_container_id text,
  external_media_id text,
  provider_state jsonb NOT NULL DEFAULT '{}',
  permalink text,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_version_id,platform)
);
