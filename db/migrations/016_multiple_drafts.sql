-- Preserve old jobs under the first scheduled slot; each new trigger has its own claim.
ALTER TABLE daily_drafts ADD COLUMN slot text NOT NULL DEFAULT 'morning';
ALTER TABLE daily_drafts DROP CONSTRAINT daily_drafts_pkey;
ALTER TABLE daily_drafts ADD CONSTRAINT daily_drafts_pkey PRIMARY KEY (day, slot);
CREATE INDEX daily_drafts_day_created_idx ON daily_drafts(day DESC, created_at DESC);
