-- Operator decision requests of the executive kernel (task B-06, docs/ai-business/02 §5). Additive only; nothing writes
-- these rows yet and an approved row executes nothing – acting on a decision is a separate, later step.
--
-- Pattern of publish_approvals (migration 029): a decision belongs to exactly one subject, version and fingerprint; a new
-- version supersedes the pending one; an approved or rejected row always carries the request message, the reply message,
-- the deciding authority and the time. Only decision levels (L3a, L3b, L4) can be requested; executable levels never.
CREATE TABLE IF NOT EXISTS enterprise_decisions (
  id uuid PRIMARY KEY,
  subject_key text NOT NULL CHECK (length(subject_key) BETWEEN 1 AND 200),
  version integer NOT NULL CHECK (version >= 1),
  task_id uuid REFERENCES enterprise_tasks(id),
  plan_id text,
  level text NOT NULL CHECK (level IN ('L3a','L3b','L4')),
  department text NOT NULL CHECK (department ~ '^[a-z][a-z_]{1,39}$'),
  task_kind text NOT NULL CHECK (task_kind ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 500),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendation jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','superseded')),
  authority text CHECK (authority = 'whatsapp_operator'),
  request_message_id text UNIQUE,
  decided_message_id text UNIQUE,
  decided_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject_key, version),
  CHECK (expires_at > created_at),
  CHECK ((status IN ('approved','rejected')) = (authority IS NOT NULL AND decided_message_id IS NOT NULL AND request_message_id IS NOT NULL AND decided_at IS NOT NULL))
);
-- At most one open request per subject.
CREATE UNIQUE INDEX IF NOT EXISTS enterprise_decisions_one_pending ON enterprise_decisions(subject_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS enterprise_decisions_pending ON enterprise_decisions(expires_at) WHERE status = 'pending';
