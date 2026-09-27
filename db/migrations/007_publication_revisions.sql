ALTER TABLE publication_requests
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);

ALTER TABLE publication_requests
  DROP CONSTRAINT IF EXISTS publication_requests_job_id_platform_key;

CREATE UNIQUE INDEX IF NOT EXISTS publication_request_revision_unique
  ON publication_requests(job_id,platform,revision);
