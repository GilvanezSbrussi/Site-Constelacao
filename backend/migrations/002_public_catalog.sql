CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(180) NOT NULL,
    slug VARCHAR(200) NOT NULL UNIQUE,
    short_description VARCHAR(300) NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT,
    modality VARCHAR(20) NOT NULL CHECK (modality IN ('in_person', 'online', 'hybrid')),
    workload_hours INTEGER CHECK (workload_hours IS NULL OR workload_hours > 0),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    location VARCHAR(180),
    available_spots INTEGER CHECK (available_spots IS NULL OR available_spots >= 0),
    enrolled_count INTEGER NOT NULL DEFAULT 0 CHECK (enrolled_count >= 0),
    price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
    promotional_price_cents INTEGER CHECK (promotional_price_cents IS NULL OR promotional_price_cents >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'enrollments_open', 'enrollments_closed', 'ended', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX courses_public_listing ON courses (starts_at) WHERE status IN ('published', 'enrollments_open');

CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(180) NOT NULL,
    slug VARCHAR(200) NOT NULL UNIQUE,
    short_description VARCHAR(300) NOT NULL,
    description TEXT NOT NULL,
    image_url TEXT,
    modality VARCHAR(20) NOT NULL CHECK (modality IN ('in_person', 'online', 'hybrid')),
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    location VARCHAR(180),
    available_spots INTEGER CHECK (available_spots IS NULL OR available_spots >= 0),
    enrolled_count INTEGER NOT NULL DEFAULT 0 CHECK (enrolled_count >= 0),
    price_cents INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
    promotional_price_cents INTEGER CHECK (promotional_price_cents IS NULL OR promotional_price_cents >= 0),
    status VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'enrollments_open', 'enrollments_closed', 'ended', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX events_public_listing ON events (starts_at) WHERE status IN ('published', 'enrollments_open');

CREATE TABLE contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    email VARCHAR(254) NOT NULL,
    phone VARCHAR(30),
    subject VARCHAR(160) NOT NULL,
    message TEXT NOT NULL,
    privacy_consent BOOLEAN NOT NULL CHECK (privacy_consent = TRUE),
    status VARCHAR(20) NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'in_progress', 'replied', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX contacts_created_at ON contacts (created_at DESC);

CREATE TABLE enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE RESTRICT,
    event_id UUID REFERENCES events(id) ON DELETE RESTRICT,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(254) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    city VARCHAR(100),
    state CHAR(2),
    observations VARCHAR(1000),
    privacy_consent BOOLEAN NOT NULL CHECK (privacy_consent = TRUE),
    status VARCHAR(24) NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'contacted', 'awaiting_payment', 'confirmed', 'cancelled', 'completed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT enrollment_one_target CHECK (num_nonnulls(course_id, event_id) = 1)
);

CREATE INDEX enrollments_course_created ON enrollments (course_id, created_at DESC);
CREATE INDEX enrollments_event_created ON enrollments (event_id, created_at DESC);
