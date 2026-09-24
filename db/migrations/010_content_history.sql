-- Existing UUIDs provide a deterministic, collision-free backfill. New IDs are generated in the application.
ALTER TABLE content_jobs ADD COLUMN content_id text;
UPDATE content_jobs SET content_id = 'cnt_legacy_' || replace(id::text, '-', '') WHERE content_id IS NULL;
ALTER TABLE content_jobs ALTER COLUMN content_id SET NOT NULL;
ALTER TABLE content_jobs ADD CONSTRAINT content_jobs_content_id_key UNIQUE (content_id);
ALTER TABLE content_jobs ADD CONSTRAINT content_jobs_content_id_format CHECK (content_id ~ '^cnt_[a-zA-Z0-9_]+$');
CREATE FUNCTION protect_content_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.content_id IS DISTINCT FROM OLD.content_id OR NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION 'content_id and product_id are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER content_id_immutable BEFORE UPDATE ON content_jobs
  FOR EACH ROW EXECUTE FUNCTION protect_content_id();

ALTER TABLE publications ADD COLUMN external_post_id text;
CREATE UNIQUE INDEX publications_external_post_unique ON publications(platform,external_post_id) WHERE external_post_id IS NOT NULL;
UPDATE publications p SET external_post_id=r.meta_post_id
  FROM (SELECT job_id,min(meta_post_id) AS meta_post_id FROM publication_requests
    WHERE status='published' AND meta_post_id IS NOT NULL GROUP BY job_id
    HAVING count(DISTINCT meta_post_id)=1) r
  WHERE p.job_id=r.job_id AND p.platform='facebook' AND p.external_post_id IS NULL;
CREATE FUNCTION protect_publication_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.platform IS DISTINCT FROM OLD.platform
    OR (OLD.external_post_id IS NOT NULL AND NEW.external_post_id IS DISTINCT FROM OLD.external_post_id) THEN
    RAISE EXCEPTION 'publication identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publication_identity_immutable BEFORE UPDATE ON publications
  FOR EACH ROW EXECUTE FUNCTION protect_publication_identity();

CREATE TABLE content_performance_snapshots (
  id uuid PRIMARY KEY,
  content_id text NOT NULL REFERENCES content_jobs(content_id) ON DELETE RESTRICT,
  publication_id uuid NOT NULL REFERENCES publications(id) ON DELETE RESTRICT,
  platform text NOT NULL CHECK (platform IN ('facebook','instagram')),
  external_post_id text NOT NULL,
  source text NOT NULL,
  source_snapshot_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  impressions bigint CHECK(impressions >= 0), reach bigint CHECK(reach >= 0),
  views bigint CHECK(views >= 0), likes bigint CHECK(likes >= 0),
  comments bigint CHECK(comments >= 0), shares bigint CHECK(shares >= 0),
  saves bigint CHECK(saves >= 0), profile_visits bigint CHECK(profile_visits >= 0),
  followers_delta bigint,
  UNIQUE(source,source_snapshot_id),
  UNIQUE(publication_id,source,observed_at)
);
CREATE INDEX content_performance_timeline ON content_performance_snapshots(content_id,source,observed_at DESC);

CREATE TABLE affiliate_tracking (
  content_id text PRIMARY KEY REFERENCES content_jobs(content_id) ON DELETE RESTRICT,
  provider text NOT NULL,
  tracking_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,tracking_id)
);
-- tracking_id stays NULL until a provider confirms a unique per-content identifier.
CREATE FUNCTION protect_tracking_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.content_id IS DISTINCT FROM NEW.content_id OR OLD.provider IS DISTINCT FROM NEW.provider
     OR (OLD.tracking_id IS NOT NULL AND OLD.tracking_id IS DISTINCT FROM NEW.tracking_id) THEN
    RAISE EXCEPTION 'affiliate binding is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER affiliate_binding_immutable BEFORE UPDATE ON affiliate_tracking
  FOR EACH ROW EXECUTE FUNCTION protect_tracking_id();
CREATE TABLE affiliate_performance_snapshots (
  id uuid PRIMARY KEY,
  content_id text NOT NULL REFERENCES affiliate_tracking(content_id) ON DELETE RESTRICT,
  source text NOT NULL,
  source_snapshot_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  clicks bigint CHECK(clicks >= 0), orders bigint CHECK(orders >= 0),
  commission_cents bigint CHECK(commission_cents >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
  UNIQUE(source,source_snapshot_id),
  UNIQUE(content_id,source,observed_at)
);
CREATE INDEX affiliate_performance_timeline ON affiliate_performance_snapshots(content_id,source,observed_at DESC);

CREATE TABLE product_price_history (
  id uuid PRIMARY KEY,
  product_id text NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  content_id text REFERENCES content_jobs(content_id) ON DELETE RESTRICT,
  source text NOT NULL,
  source_snapshot_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  price_cents bigint NOT NULL CHECK(price_cents >= 0),
  reference_price_cents bigint CHECK(reference_price_cents >= 0),
  currency text NOT NULL CHECK(currency='EUR'),
  UNIQUE(source,source_snapshot_id),
  UNIQUE(product_id,source,observed_at)
);
CREATE INDEX product_price_timeline ON product_price_history(product_id,observed_at DESC);

CREATE TABLE content_cost_events (
  id uuid PRIMARY KEY,
  content_id text NOT NULL REFERENCES content_jobs(content_id) ON DELETE RESTRICT,
  source text NOT NULL,
  source_event_id text NOT NULL,
  incurred_at timestamptz NOT NULL,
  kind text NOT NULL CHECK(kind IN ('production','api')),
  amount_cents bigint NOT NULL CHECK(amount_cents >= 0),
  currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
  UNIQUE(source,source_event_id)
);

CREATE FUNCTION verify_social_content_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM publications p JOIN content_jobs j ON j.id=p.job_id
    WHERE p.id=NEW.publication_id AND j.content_id=NEW.content_id
      AND p.platform=NEW.platform AND p.external_post_id=NEW.external_post_id
  ) THEN RAISE EXCEPTION 'publication/content/external post mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION verify_price_content_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.content_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM content_jobs WHERE content_id=NEW.content_id AND product_id=NEW.product_id
  ) THEN RAISE EXCEPTION 'product/content mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER social_content_reference BEFORE INSERT ON content_performance_snapshots
  FOR EACH ROW EXECUTE FUNCTION verify_social_content_reference();
CREATE TRIGGER price_content_reference BEFORE INSERT ON product_price_history
  FOR EACH ROW EXECUTE FUNCTION verify_price_content_reference();

CREATE FUNCTION forbid_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'historical observations are append-only'; END $$;
CREATE TRIGGER social_history_immutable BEFORE UPDATE OR DELETE ON content_performance_snapshots FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER affiliate_history_immutable BEFORE UPDATE OR DELETE ON affiliate_performance_snapshots FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER price_history_immutable BEFORE UPDATE OR DELETE ON product_price_history FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();
CREATE TRIGGER cost_history_immutable BEFORE UPDATE OR DELETE ON content_cost_events FOR EACH ROW EXECUTE FUNCTION forbid_history_mutation();

CREATE VIEW content_performance_deltas AS
SELECT s.*, s.views - lag(s.views) OVER w AS views_delta,
  s.impressions - lag(s.impressions) OVER w AS impressions_delta,
  s.reach - lag(s.reach) OVER w AS reach_delta
FROM content_performance_snapshots s
WINDOW w AS (PARTITION BY s.content_id,s.source,s.publication_id ORDER BY s.observed_at,s.id);
CREATE VIEW affiliate_performance_deltas AS
SELECT s.*, s.clicks - lag(s.clicks) OVER w AS clicks_delta,
  s.orders - lag(s.orders) OVER w AS orders_delta,
  s.commission_cents - lag(s.commission_cents) OVER w AS commission_delta_cents
FROM affiliate_performance_snapshots s
WINDOW w AS (PARTITION BY s.content_id,s.source ORDER BY s.observed_at,s.id);
