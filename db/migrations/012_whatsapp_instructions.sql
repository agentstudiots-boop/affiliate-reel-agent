-- One durable interpretation per original WhatsApp event, linked to existing job identity.
CREATE TABLE IF NOT EXISTS whatsapp_instructions (
 message_id text PRIMARY KEY REFERENCES whatsapp_events(message_id),
 job_id uuid REFERENCES content_jobs(id),
 publication_id uuid REFERENCES publication_requests(id),
 context_hash text,
 status text NOT NULL CHECK(status IN ('parsing','parsed','applied','clarify')),
 interpretation jsonb,
 error_code text,
 notice_attempted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_instructions_job ON whatsapp_instructions(job_id,created_at);
