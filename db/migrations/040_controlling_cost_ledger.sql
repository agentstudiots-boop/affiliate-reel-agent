-- Controlling cost and revenue ledger (task E-01, docs/ai-business/02 §5). Additive only; nothing reads or writes these
-- tables yet. Importers (E-03), manual entries (E-04) and the snapshot (E-07) follow.
--
-- Invariants held by the schema itself (no invented numbers):
-- * a price needs a source URL and the person who entered it; nothing is pre-filled;
-- * an amount derived from usage needs the price it was computed with; only invoices and manual entries carry an amount
--   without a catalogue price; an unknown amount stays NULL instead of 0, and only a known amount has a currency;
-- * cost amounts are kept in micro currency units (1 EUR = 1 000 000), like catalogue prices: a single model call usually
--   costs less than a cent, so rounding each line to cents would book real costs as 0. Cents only appear in sums;
-- * lines imported from usage data (model_calls, provider_usage, production_runs) are always measured;
-- * every imported row is unique per (source, source_ref), so imports are idempotent and a call is never counted twice;
-- * measured revenue always has an amount; a budget without an operator decision is only a proposal.
CREATE TABLE IF NOT EXISTS price_catalog (
  id uuid PRIMARY KEY,
  provider text NOT NULL CHECK (provider ~ '^[a-z0-9][a-z0-9_.-]{0,59}$'),
  item text NOT NULL CHECK (length(item) BETWEEN 1 AND 120),
  unit text NOT NULL CHECK (unit IN ('input_token','output_token','second','image','video_second','request','month')),
  price_micros bigint NOT NULL CHECK (price_micros >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  entered_by text NOT NULL CHECK (length(entered_by) BETWEEN 1 AND 100),
  entered_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  UNIQUE (provider, item, unit, valid_from)
);
-- Overlapping validity is allowed (a new price may start while the old one has no end yet): readers take the newest
-- valid_from that is valid at the time of use. Each model is priced on one basis only – tokens or seconds, never both.

CREATE TABLE IF NOT EXISTS cost_entries (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  department text CHECK (department ~ '^[a-z][a-z_]{1,39}$'),
  agent text,
  task_id uuid REFERENCES enterprise_tasks(id),
  provider text NOT NULL,
  -- What was used, e.g. the model for model_calls; with provider and unit it identifies the catalogue price.
  item text CHECK (item IS NULL OR length(item) BETWEEN 1 AND 120),
  category text NOT NULL CHECK (category IN ('model','media','research','infra','subscription','other')),
  quantity numeric NOT NULL CHECK (quantity >= 0),
  unit text NOT NULL,
  amount_micros bigint CHECK (amount_micros >= 0),
  currency text CHECK (currency ~ '^[A-Z]{3}$'),
  value_kind text NOT NULL CHECK (value_kind IN ('measured','estimated','forecast')),
  source text NOT NULL CHECK (source IN ('model_calls','provider_usage','production_runs','invoice','manual')),
  source_ref text NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 200),
  price_catalog_id uuid REFERENCES price_catalog(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_ref),
  CHECK (amount_micros IS NULL OR price_catalog_id IS NOT NULL OR source IN ('invoice','manual')),
  CHECK ((amount_micros IS NULL) = (currency IS NULL)),
  CHECK (source IN ('invoice','manual') OR value_kind = 'measured')
);
CREATE INDEX IF NOT EXISTS cost_entries_department_time ON cost_entries(department, occurred_at);

CREATE TABLE IF NOT EXISTS revenue_entries (
  id uuid PRIMARY KEY,
  period_start date NOT NULL,
  period_end date NOT NULL,
  department text NOT NULL CHECK (department ~ '^[a-z][a-z_]{1,39}$'),
  channel text NOT NULL CHECK (length(channel) BETWEEN 1 AND 60),
  -- Can be negative (cancellations, returns); NULL = not known yet.
  amount_cents bigint,
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  value_kind text NOT NULL CHECK (value_kind IN ('measured','estimated','forecast')),
  source text NOT NULL CHECK (source IN ('partnernet_export','csv_import','manual')),
  source_ref text NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 200),
  entered_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (value_kind <> 'measured' OR amount_cents IS NOT NULL),
  UNIQUE (source, source_ref)
);
CREATE INDEX IF NOT EXISTS revenue_entries_department_period ON revenue_entries(department, period_start);

-- Monthly limits per department. A hard limit is binding only with the operator's decision (approved_decision_id;
-- enterprise_decisions follows with B-06, hence no foreign key yet). Without it the budget guard treats the limit as 0.
CREATE TABLE IF NOT EXISTS budgets (
  id uuid PRIMARY KEY,
  department text NOT NULL CHECK (department ~ '^[a-z][a-z_]{1,39}$'),
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  limit_cents bigint NOT NULL CHECK (limit_cents >= 0),
  kind text NOT NULL CHECK (kind IN ('hard','soft')),
  approved_decision_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department, period, kind)
);
