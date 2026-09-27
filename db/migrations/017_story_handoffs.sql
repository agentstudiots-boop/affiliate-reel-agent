CREATE TABLE story_handoffs (
  publication_id uuid PRIMARY KEY REFERENCES publication_requests(id),
  send_attempted_at timestamptz NOT NULL DEFAULT now(),
  whatsapp_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
