-- Each manual content revision needs its own WhatsApp approval before a producer can start.
CREATE TABLE IF NOT EXISTS content_approval_requests (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES content_jobs(id),
  content_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','changes_requested')),
  approver_wa_id text NOT NULL,
  whatsapp_message_id text UNIQUE,
  whatsapp_send_attempted_at timestamptz,
  feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS content_approval_pending_job ON content_approval_requests(job_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS content_approval_job_recent ON content_approval_requests(job_id,created_at DESC);
