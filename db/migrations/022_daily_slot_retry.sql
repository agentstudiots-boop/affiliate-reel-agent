-- A scheduled slot may be retried after a failed or killed attempt. The job id
-- changes per attempt; the (day,slot) key still prevents two concurrent runs.
ALTER TABLE daily_drafts ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1;
