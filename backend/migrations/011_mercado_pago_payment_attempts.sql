CREATE TABLE enrollment_payment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID NOT NULL REFERENCES enrollment_payments(enrollment_id) ON DELETE CASCADE,
    provider_payment_id VARCHAR(120) NOT NULL UNIQUE,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    status VARCHAR(24) NOT NULL
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back')),
    provider_status VARCHAR(40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX enrollment_payment_attempts_enrollment_created
    ON enrollment_payment_attempts (enrollment_id, created_at DESC);
