-- Central publish approval barrier for the topic / multi-format pipeline.
-- An approval belongs to exactly one content id + version + fingerprint. Any content change creates a new
-- version and invalidates every earlier pending or approved decision. Every publish attempt is recorded,
-- blocked ones included; (content, version, platform) can be claimed once.
CREATE TABLE IF NOT EXISTS content_versions (
  content_id text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  platforms text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_id, version)
);

CREATE TABLE IF NOT EXISTS publish_approvals (
  content_id text NOT NULL,
  version integer NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','changes_requested','invalidated')),
  authority text CHECK (authority IN ('whatsapp_operator','executive_agent')),
  request_message_id text UNIQUE,
  decision_message_id text UNIQUE,
  decided_at timestamptz,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (content_id, version),
  FOREIGN KEY (content_id, version) REFERENCES content_versions(content_id, version),
  -- Hard invariant in the schema itself: an approved row always carries its authority, decision message and time.
  CHECK (status <> 'approved' OR (authority IS NOT NULL AND decision_message_id IS NOT NULL AND request_message_id IS NOT NULL AND decided_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS publish_attempts (
  id uuid PRIMARY KEY,
  content_id text NOT NULL,
  version integer,
  platform text NOT NULL,
  origin text NOT NULL,
  status text NOT NULL CHECK (status IN ('blocked','claimed','published','failed','unknown')),
  reason text,
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- At most one live claim per content version and platform: no double posting through retries or cron.
CREATE UNIQUE INDEX IF NOT EXISTS publish_attempts_one_claim ON publish_attempts(content_id, version, platform) WHERE status IN ('claimed','published','unknown');
CREATE INDEX IF NOT EXISTS publish_attempts_recent ON publish_attempts(created_at DESC);
