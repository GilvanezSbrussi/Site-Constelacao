CREATE TABLE enrollment_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID NOT NULL UNIQUE REFERENCES enrollments(id) ON DELETE RESTRICT,
    provider VARCHAR(30) NOT NULL DEFAULT 'mercado_pago' CHECK (provider = 'mercado_pago'),
    preference_id VARCHAR(120) UNIQUE,
    provider_payment_id VARCHAR(120) UNIQUE,
    checkout_url TEXT NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
    status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back')),
    provider_status VARCHAR(40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX enrollment_payments_status_created ON enrollment_payments (status, created_at DESC);

INSERT INTO site_settings (key, value) VALUES
    ('payment_enabled', 'false'::jsonb),
    ('payment_access_token_encrypted', '""'::jsonb),
    ('payment_webhook_secret_encrypted', '""'::jsonb),
    ('payment_environment', '"sandbox"'::jsonb),
    ('payment_public_url', '""'::jsonb),
    ('payment_max_installments', '1'::jsonb)
ON CONFLICT (key) DO NOTHING;
