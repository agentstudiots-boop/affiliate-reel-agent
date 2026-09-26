CREATE TABLE IF NOT EXISTS publication_requests (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES content_jobs(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook')),
  status text NOT NULL CHECK (status IN ('preparing','pending','approved','changes_requested','rejected','publishing','published','unknown')),
  caption text NOT NULL,
  image_url text,
  content_hash text NOT NULL,
  approver_wa_id text NOT NULL,
  whatsapp_message_id text UNIQUE,
  whatsapp_send_attempted_at timestamptz,
  feedback text NOT NULL DEFAULT '',
  decided_at timestamptz,
  publish_attempted_at timestamptz,
  meta_post_id text UNIQUE,
  permalink text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id,platform),
  CHECK (image_url IS NULL OR image_url ~ '^https://'),
  CHECK (permalink IS NULL OR permalink ~ '^https://')
);

ALTER TABLE daily_drafts DROP CONSTRAINT IF EXISTS daily_drafts_status_check;
ALTER TABLE daily_drafts ADD CONSTRAINT daily_drafts_status_check
  CHECK (status IN ('claimed','planning','awaiting_approval','needs_input','failed','content_approved','changes_requested','rejected'));
ALTER TABLE daily_drafts ADD COLUMN IF NOT EXISTS feedback text NOT NULL DEFAULT '';
