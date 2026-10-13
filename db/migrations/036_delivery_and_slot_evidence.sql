-- Verifiable evidence for the daily approval chain (additive only).
-- 1. Delivery statuses Meta reports for messages we sent (sent → delivered → read, or failed with an error code).
--    Only ids, statuses and provider error codes; no message text, no phone numbers.
CREATE TABLE IF NOT EXISTS whatsapp_delivery_statuses (
  message_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent','delivered','read','failed')),
  error_code integer,
  error_title text,
  provider_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, status)
);
CREATE INDEX IF NOT EXISTS whatsapp_delivery_statuses_recent ON whatsapp_delivery_statuses(received_at DESC);

-- 2. One row per scheduled cron invocation of /api/cron/daily-draft, whatever its outcome (also "outside window",
--    "waiting for the operator's 24 h window" and errors). Runtime logs of the hosting plan are kept for one hour only.
CREATE TABLE IF NOT EXISTS daily_slot_runs (
  id uuid PRIMARY KEY,
  invoked_at timestamptz NOT NULL DEFAULT now(),
  day date,
  slot text,
  outcome text NOT NULL,
  whatsapp text,
  job_id uuid,
  reason text
);
CREATE INDEX IF NOT EXISTS daily_slot_runs_recent ON daily_slot_runs(invoked_at DESC);
