ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS provider_script text;
ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS provider_voice_id text;
ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS provider_request_key uuid UNIQUE;
ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS provider_request_attempted_at timestamptz;
ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS render_request_key uuid UNIQUE;
ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS render_request_attempted_at timestamptz;
ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS render_id text UNIQUE;
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS whatsapp_send_attempted_at timestamptz;
