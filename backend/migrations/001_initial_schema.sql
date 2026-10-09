CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(80) NOT NULL UNIQUE,
    description VARCHAR(180) NOT NULL
);

CREATE TABLE role_permissions (
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX users_email_unique ON users (LOWER(email));

CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

INSERT INTO roles (code, name) VALUES
    ('admin', 'Administrador'),
    ('editor', 'Editor'),
    ('attendant', 'Atendente');

INSERT INTO permissions (code, description) VALUES
    ('content:manage', 'Gerenciar conteudo do site'),
    ('courses:manage', 'Gerenciar cursos'),
    ('events:manage', 'Gerenciar eventos'),
    ('enrollments:read', 'Visualizar inscricoes'),
    ('enrollments:manage', 'Atualizar inscricoes'),
    ('contacts:manage', 'Gerenciar contatos'),
    ('users:manage', 'Gerenciar usuarios administrativos'),
    ('settings:manage', 'Alterar configuracoes do site'),
    ('reports:read', 'Visualizar e exportar relatorios');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.code = 'admin';

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.code = 'editor'
  AND permissions.code IN ('content:manage', 'courses:manage', 'events:manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles CROSS JOIN permissions
WHERE roles.code = 'attendant'
  AND permissions.code IN ('enrollments:read', 'enrollments:manage', 'contacts:manage');
