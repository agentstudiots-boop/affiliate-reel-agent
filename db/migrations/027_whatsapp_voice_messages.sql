-- Idempotency/state for WhatsApp voice messages. Stores NO audio and NO transcript: only the message id and a short status.
CREATE TABLE IF NOT EXISTS whatsapp_voice_messages (
  message_id text PRIMARY KEY,
  wa_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('processing','done','failed','ignored')),
  failure text,
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
