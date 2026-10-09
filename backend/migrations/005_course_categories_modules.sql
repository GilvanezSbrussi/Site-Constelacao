CREATE TABLE course_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(140) NOT NULL UNIQUE,
    description VARCHAR(500) NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX course_categories_name_unique ON course_categories (LOWER(name));

ALTER TABLE courses
    ADD COLUMN category_id UUID REFERENCES course_categories(id) ON DELETE SET NULL;

CREATE INDEX courses_category_id ON courses (category_id);

CREATE TABLE course_modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(180) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL CHECK (position > 0),
    workload_hours INTEGER CHECK (workload_hours IS NULL OR workload_hours > 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX course_modules_ordered ON course_modules (course_id, position, created_at);
