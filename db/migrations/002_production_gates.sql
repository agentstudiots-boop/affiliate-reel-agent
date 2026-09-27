CREATE TABLE IF NOT EXISTS production_runs (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL UNIQUE REFERENCES content_jobs(id) ON DELETE CASCADE,
  content_type text NOT NULL CHECK (content_type IN ('video','image','text')),
  provider text NOT NULL CHECK (provider IN ('faceless_video','runway')),
  provider_mode text NOT NULL CHECK (provider_mode IN ('FACELESS_STORYBOARD','RUNWAY_SINGLE_CLIP')),
  status text NOT NULL CHECK (status IN ('draft','needs_provider_quote','awaiting_whatsapp_approval','changes_requested','approved_for_spend','rendering','ready','failed','cancelled')),
  estimated_cost_cents bigint CHECK (estimated_cost_cents >= 0),
  estimated_provider_credits numeric CHECK (estimated_provider_credits >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  provider_job_id text UNIQUE,
  output_url text,
  revision_request text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (output_url IS NULL OR output_url ~ '^https://')
);
CREATE INDEX IF NOT EXISTS production_status ON production_runs(status,created_at DESC);

CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY,
  production_run_id uuid NOT NULL REFERENCES production_runs(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('render','publish')),
  status text NOT NULL CHECK (status IN ('pending','approved','changes_requested','rejected','consumed')),
  approval_token text NOT NULL UNIQUE,
  estimated_cost_cents bigint CHECK (estimated_cost_cents >= 0),
  estimated_commission_cents bigint CHECK (estimated_commission_cents >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  summary text NOT NULL,
  whatsapp_message_id text UNIQUE,
  approver_wa_id text,
  feedback text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_approval_per_stage
  ON approval_requests(production_run_id,kind) WHERE status='pending';

CREATE TABLE IF NOT EXISTS whatsapp_events (
  message_id text PRIMARY KEY,
  wa_id text NOT NULL,
  reply_to_message_id text,
  body text NOT NULL DEFAULT '',
  intent text CHECK (intent IN ('approve','reject','changes_requested')),
  production_run_id uuid REFERENCES production_runs(id) ON DELETE SET NULL,
  approval_request_id uuid REFERENCES approval_requests(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_received ON whatsapp_events(received_at DESC);
