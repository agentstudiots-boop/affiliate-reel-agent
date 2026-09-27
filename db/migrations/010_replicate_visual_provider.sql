-- Preserve prior attempts while allowing the second verified image provider.
ALTER TABLE original_visual_attempts DROP CONSTRAINT IF EXISTS original_visual_attempts_provider_check;
ALTER TABLE original_visual_attempts ADD CONSTRAINT original_visual_attempts_provider_check
  CHECK (provider IN ('openai', 'replicate'));
