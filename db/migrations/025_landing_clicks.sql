-- Click counter for the public landing page: only which published item was clicked and when.
-- No IP address, user agent or other personal data is stored.
CREATE TABLE IF NOT EXISTS landing_clicks (
  id bigserial PRIMARY KEY,
  publication_id uuid NOT NULL REFERENCES publication_requests(id) ON DELETE CASCADE,
  job_id uuid NOT NULL,
  clicked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS landing_clicks_by_publication ON landing_clicks(publication_id,clicked_at DESC);
