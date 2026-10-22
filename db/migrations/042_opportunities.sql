-- Opportunity Scout ledger (task F-02, docs/ai-business/02 §6). Additive only; nothing writes these rows until the scout
-- (F-03) or the operator trigger (F-05) is switched on.
--
-- An opportunity is a business idea to be checked; an assessment is one versioned evaluation of it. The stored evaluation and
-- economics are always computed by the reviewed pure functions (F-01 scoring, F-04 economics) from the stored inputs –
-- never taken from a caller or a model. A "recommend_test" is a recommendation to the operator, never an approval: acting
-- on it needs a separate decision request (B-06). Research cost is recorded as measured usage of the assessment.
CREATE TABLE IF NOT EXISTS opportunities (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 2000),
  origin text NOT NULL CHECK (origin IN ('operator','scout','executive')),
  -- The WhatsApp message that asked for it (F-05): one opportunity per message, redeliveries are idempotent.
  source_message_id text UNIQUE,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','researching','assessed','rejected','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS opportunities_status ON opportunities(status, updated_at);

CREATE TABLE IF NOT EXISTS opportunity_assessments (
  id uuid PRIMARY KEY,
  opportunity_id uuid NOT NULL REFERENCES opportunities(id),
  version integer NOT NULL CHECK (version >= 1),
  weights_version text NOT NULL CHECK (length(weights_version) BETWEEN 1 AND 80),
  criteria jsonb NOT NULL,          -- CriterionAssessment[] as given (F-01 input)
  evaluation jsonb NOT NULL,        -- OpportunityEvaluation computed by evaluateOpportunity
  economics jsonb NOT NULL,         -- EconomicsAssessment computed by assessEconomics
  recommendation text NOT NULL CHECK (recommendation IN ('recommend_test','not_recommended','blocked')),
  test_recommended boolean NOT NULL,
  research jsonb NOT NULL DEFAULT '[]'::jsonb,  -- sources consulted (reference + note), never page contents
  model_calls integer NOT NULL DEFAULT 0 CHECK (model_calls >= 0),
  cost_cents bigint NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  task_id uuid REFERENCES enterprise_tasks(id),
  created_by text NOT NULL CHECK (created_by IN ('operator','executive','department')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, version),
  CHECK (NOT test_recommended OR recommendation = 'recommend_test')
);
CREATE INDEX IF NOT EXISTS opportunity_assessments_latest ON opportunity_assessments(opportunity_id, version DESC);
