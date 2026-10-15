-- Model call ledger (additive only): one row per paid language/vision/transcription model call, for cost and quality
-- monitoring per agent. No prompts, no outputs, no personal data: agent, model, outcome, latency and provider metrics.
CREATE TABLE IF NOT EXISTS model_calls (
  id bigserial PRIMARY KEY,
  agent text NOT NULL,
  model text NOT NULL,
  provider text NOT NULL DEFAULT 'replicate',
  ok boolean NOT NULL,
  error_class text,
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  prediction_id text,
  input_tokens integer,
  output_tokens integer,
  predict_time_s numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS model_calls_recent ON model_calls(created_at DESC);
CREATE INDEX IF NOT EXISTS model_calls_agent ON model_calls(agent, created_at DESC);
