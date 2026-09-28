-- Repair deployments whose slot column exists but whose original day-only key remained.
DO $$
DECLARE existing_key text;
BEGIN
  SELECT c.conname INTO existing_key FROM pg_constraint c
  WHERE c.conrelid='public.daily_drafts'::regclass AND c.contype='p';
  IF existing_key IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.daily_drafts'::regclass
    AND c.contype='p' AND
      (SELECT array_agg(a.attname ORDER BY k.ordinality)
       FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
       JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)
       = ARRAY['day','slot']::name[]
  ) THEN
    EXECUTE format('ALTER TABLE daily_drafts DROP CONSTRAINT %I', existing_key);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.daily_drafts'::regclass AND contype='p') THEN
    ALTER TABLE daily_drafts ADD CONSTRAINT daily_drafts_pkey PRIMARY KEY(day,slot);
  END IF;
END $$;
