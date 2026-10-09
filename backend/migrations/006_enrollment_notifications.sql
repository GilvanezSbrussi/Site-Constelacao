CREATE TABLE notification_outbox (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('admin', 'customer')),
    recipient_email VARCHAR(254),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    last_error VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (recipient_type = 'admin' OR recipient_email IS NOT NULL)
);

CREATE INDEX notification_outbox_pending
    ON notification_outbox (next_attempt_at, created_at)
    WHERE status IN ('pending', 'processing');

INSERT INTO site_settings (key, value) VALUES
    ('notification_admin_email', '""'::jsonb),
    ('enrollment_admin_subject', '"Nova inscrição recebida: {{activity}}"'::jsonb),
    ('enrollment_admin_message', '"Nova inscrição recebida para {{activity}} ({{type}}).\n\nNome: {{name}}\nE-mail: {{email}}\nTelefone: {{phone}}\nData: {{date}}"'::jsonb),
    ('enrollment_customer_subject', '"Recebemos sua inscrição: {{activity}}"'::jsonb),
    ('enrollment_customer_message', '"Olá, {{name}}!\n\nRecebemos sua inscrição para {{activity}}. Em breve entraremos em contato.\n\n{{siteName}}"'::jsonb)
ON CONFLICT (key) DO NOTHING;
