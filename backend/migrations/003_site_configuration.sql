CREATE TABLE instructors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(140) NOT NULL UNIQUE,
    biography TEXT NOT NULL DEFAULT '',
    qualifications TEXT NOT NULL DEFAULT '',
    specialties TEXT NOT NULL DEFAULT '',
    photo_url TEXT,
    instagram_url TEXT,
    website_url TEXT,
    email VARCHAR(254),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE course_instructors (
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE RESTRICT,
    PRIMARY KEY (course_id, instructor_id)
);

CREATE INDEX course_instructors_by_instructor ON course_instructors (instructor_id, course_id);

CREATE TABLE site_settings (
    key VARCHAR(80) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO permissions (code, description) VALUES
    ('instructors:manage', 'Gerenciar instrutores'),
    ('settings:manage', 'Alterar configuracoes do site'),
    ('users:manage', 'Gerenciar usuarios administrativos')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.code = 'admin'
  AND permissions.code IN ('instructors:manage', 'settings:manage', 'users:manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.code = 'editor'
  AND permissions.code = 'instructors:manage'
ON CONFLICT DO NOTHING;

INSERT INTO site_settings (key, value) VALUES
    ('site_name', '"Constelacao Familiar"'::jsonb),
    ('tagline', '"Um espaco de escuta e encontro."'::jsonb),
    ('banner_title', '"Um novo olhar para as relacoes."'::jsonb),
    ('banner_subtitle', '"Encontros e formacoes em Constelacao Familiar para ampliar perspectivas sobre as relacoes e a propria historia."'::jsonb),
    ('contact_email', '""'::jsonb),
    ('phone', '""'::jsonb),
    ('whatsapp_number', '""'::jsonb),
    ('whatsapp_message', '"Ola! Gostaria de saber mais sobre os encontros."'::jsonb),
    ('address', '""'::jsonb),
    ('instagram_url', '""'::jsonb),
    ('facebook_url', '""'::jsonb),
    ('tiktok_url', '""'::jsonb),
    ('youtube_url', '""'::jsonb),
    ('linkedin_url', '""'::jsonb),
    ('primary_color', '"#183f35"'::jsonb),
    ('secondary_color', '"#ab4938"'::jsonb)
ON CONFLICT (key) DO NOTHING;
