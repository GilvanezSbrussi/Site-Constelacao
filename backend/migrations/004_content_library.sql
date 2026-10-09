CREATE TABLE blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(180) NOT NULL,
    slug VARCHAR(200) NOT NULL UNIQUE,
    excerpt VARCHAR(300) NOT NULL,
    content TEXT NOT NULL,
    image_url TEXT,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX blog_posts_active_published ON blog_posts (active, published_at DESC);

CREATE TABLE testimonials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    role VARCHAR(120),
    quote TEXT NOT NULL,
    avatar_url TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE faqs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question VARCHAR(200) NOT NULL,
    answer TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE gallery_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(180) NOT NULL,
    description VARCHAR(300) NOT NULL DEFAULT '',
    image_url TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO blog_posts (title, slug, excerpt, content, image_url, published_at, active)
VALUES (
    'Como a Constelação Familiar pode ajudar na escuta de relações',
    'como-a-constelacao-familiar-pode-ajudar-na-escuta-de-relacoes',
    'Uma visão prática sobre como a abordagem pode ampliar a maneira de ouvir vínculos e histórias.',
    'A Constelação Familiar oferece um espaço de escuta para observar padrões que muitas vezes escapam do cotidiano. Em vez de buscar respostas prontas, a proposta convida a perceber conexões, silêncios e dinâmicas que influenciam as relações.',
    'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=1200&q=80',
    NOW() - INTERVAL '7 days',
    TRUE
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO testimonials (name, role, quote, avatar_url, active)
VALUES
    ('Marina S.', 'Participante de formação', 'O encontro me ajudou a enxergar o peso de certas dinâmicas com mais clareza. O cuidado da escuta foi o que mais me marcou.', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=400&q=80', TRUE),
    ('Carlos A.', 'Coordenador de grupo', 'A abordagem abriu espaço para olhar minhas relações com mais serenidade e presença. Foi uma experiência profunda e acolhedora.', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=80', TRUE);

INSERT INTO faqs (question, answer, active)
VALUES
    ('A Constelação Familiar é para qualquer pessoa?', 'Sim. A abordagem pode ser interessante para pessoas que desejam refletir sobre relações, traumas familiares, padrões e escolhas pessoais, com respeito ao tempo e ao acolhimento de cada pessoa.', TRUE),
    ('Os encontros são em grupo?', 'Grande parte dos encontros acontece em grupos, com cuidado e estrutura de acolhimento. Há também formações e vivências que podem ter diferentes formatos conforme a proposta.', TRUE),
    ('Preciso ter experiência prévia?', 'Não é necessário ter experiência anterior. O espaço é preparado para receber pessoas em diferentes níveis de familiaridade com a abordagem.', TRUE);

INSERT INTO gallery_items (title, description, image_url, active)
VALUES
    ('Encontro de acolhimento', 'Um momento de escuta e presença em grupo.', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=1200&q=80', TRUE),
    ('Formação em grupo', 'Espaço para aprofundar a prática com cuidado e troca.', 'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?auto=format&fit=crop&w=1200&q=80', TRUE);
