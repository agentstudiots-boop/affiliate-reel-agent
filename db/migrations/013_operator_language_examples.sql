-- Only explicitly approved interpretations; existing content_jobs identity.
CREATE TABLE IF NOT EXISTS operator_language_examples (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operator_wa_id text NOT NULL,
 source_message_id text NOT NULL REFERENCES whatsapp_events(message_id),
 confirmation_message_id text NOT NULL REFERENCES whatsapp_events(message_id),
 operator_message text NOT NULL CHECK(length(operator_message) BETWEEN 1 AND 1000),
 interpreted_intent text NOT NULL CHECK(interpreted_intent IN ('revise_image','revise_text','revise_both','approve','reject')),
 structured_instruction jsonb NOT NULL,
 operator_correction text CHECK(length(operator_correction)<=1000),
 product_context jsonb NOT NULL,
 content_id uuid NOT NULL REFERENCES content_jobs(id),
 confirmed boolean NOT NULL DEFAULT true CHECK(confirmed),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_message_id,confirmation_message_id)
);
CREATE INDEX operator_language_examples_lookup ON operator_language_examples(operator_wa_id,created_at DESC);
