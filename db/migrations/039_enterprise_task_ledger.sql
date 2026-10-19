-- Executive task ledger (task B-02, docs/ai-business/02 §4–5). Additive only; nothing reads or writes these tables yet.
-- The repository (B-03) and the budget guard (B-05) build on them behind switches that stay off.
--
-- Invariants held by the schema itself:
-- * only executable levels L0–L2 enter the ledger; decision levels (L3a/L3b/L4) become decision requests (B-06), never tasks;
-- * lease fields are set exactly while a task is leased or running;
-- * a failure class exists only on failed, dead and outcome_unknown tasks, and the class outcome_unknown only on
--   outcome_unknown tasks, so such a task cannot silently become queued again with its class kept;
-- * at most one ledger entry per idempotency key, one outbox entry per external idempotency key.
-- Held by convention of the repository (B-03), not by the schema (the codebase uses no triggers): events are only
-- inserted, the fencing token only grows, and outcome_unknown is never moved to another state automatically.
CREATE TABLE IF NOT EXISTS enterprise_tasks (
  id uuid PRIMARY KEY,
  department text NOT NULL CHECK (department ~ '^[a-z][a-z_]{1,39}$'),
  task_kind text NOT NULL CHECK (task_kind ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  handler_id text NOT NULL CHECK (handler_id ~ '^[a-z][a-z_]*\.[a-zA-Z][a-zA-Z_]*$'),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','leased','running','succeeded','failed','outcome_unknown','needs_decision','cancelled','dead')),
  priority smallint NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
  permission_level text NOT NULL CHECK (permission_level IN ('L0','L1','L2')),
  parent_id uuid REFERENCES enterprise_tasks(id),
  plan_id text,
  correlation_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  -- Same classes as FAILURE_CLASSES in lib/enterprise/contract.ts (B-04).
  failure_class text CHECK (failure_class IN ('invalid_input','budget_exhausted','deadline_exceeded','provider_error','outcome_unknown','internal')),
  max_cost_cents bigint NOT NULL DEFAULT 0 CHECK (max_cost_cents >= 0),
  max_model_calls integer NOT NULL DEFAULT 0 CHECK (max_model_calls >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 1 CHECK (max_attempts BETWEEN 1 AND 10),
  lease_holder text,
  lease_until timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  deadline timestamptz,
  created_by text NOT NULL CHECK (created_by IN ('operator','executive','cron','department')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (attempts <= max_attempts),
  CHECK ((status IN ('leased','running')) = (lease_holder IS NOT NULL AND lease_until IS NOT NULL)),
  CHECK ((status IN ('failed','outcome_unknown','dead')) = (failure_class IS NOT NULL)),
  CHECK (failure_class IS DISTINCT FROM 'outcome_unknown' OR status = 'outcome_unknown'),
  CHECK (status <> 'outcome_unknown' OR failure_class = 'outcome_unknown'),
  CHECK (status <> 'succeeded' OR (output IS NOT NULL AND failure_class IS NULL))
);
CREATE INDEX IF NOT EXISTS enterprise_tasks_queue ON enterprise_tasks(priority DESC, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS enterprise_tasks_leases ON enterprise_tasks(lease_until) WHERE status IN ('leased','running');
CREATE INDEX IF NOT EXISTS enterprise_tasks_correlation ON enterprise_tasks(correlation_id, created_at);

-- History of every state change, written in the same transaction as the change; only inserted (by convention, see above).
CREATE TABLE IF NOT EXISTS enterprise_task_events (
  id bigserial PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES enterprise_tasks(id),
  seq integer NOT NULL CHECK (seq >= 1),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z_]{1,39}$'),
  actor text NOT NULL,
  fencing_token bigint,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, seq)
);

-- External effects are only recorded here, in the transaction that changes the task; a sender settles them later.
CREATE TABLE IF NOT EXISTS enterprise_outbox (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES enterprise_tasks(id),
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  fencing_token bigint NOT NULL CHECK (fencing_token >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','outcome_unknown','failed')),
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK ((status = 'pending') = (settled_at IS NULL))
);
CREATE INDEX IF NOT EXISTS enterprise_outbox_pending ON enterprise_outbox(created_at) WHERE status = 'pending';

-- Hard budget guard (GPT-07): reserve before a paid call, settle afterwards. Unclear outcomes become disputed, never released.
CREATE TABLE IF NOT EXISTS budget_reservations (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES enterprise_tasks(id),
  department text NOT NULL CHECK (department ~ '^[a-z][a-z_]{1,39}$'),
  period text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','settled','released','disputed')),
  settled_amount_cents bigint CHECK (settled_amount_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK ((status IN ('reserved','disputed')) = (settled_at IS NULL)),
  CHECK (status <> 'settled' OR settled_amount_cents IS NOT NULL),
  CHECK (status <> 'released' OR settled_amount_cents IS NULL)
);
CREATE INDEX IF NOT EXISTS budget_reservations_period ON budget_reservations(department, period);
