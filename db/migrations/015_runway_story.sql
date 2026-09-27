ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS runway_image_url text;
ALTER TABLE production_runs ADD COLUMN IF NOT EXISTS runway_image_rights_confirmed boolean NOT NULL DEFAULT false;
ALTER TABLE production_runs ADD CONSTRAINT runway_image_https CHECK (runway_image_url IS NULL OR runway_image_url ~ '^https://');
