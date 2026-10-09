const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const jwt = require('jsonwebtoken');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { decryptSmtpPassword } = require('../src/services/smtp-secrets');

const secret = 'test-secret-with-at-least-thirty-two-characters';
const userId = '11111111-1111-4111-8111-111111111111';

function makeApp({ permissions = [], queryHandler, connectHandler, uploadDir } = {}) {
  const db = {
    async query(sql, values) {
      if (sql.includes('FROM users WHERE id')) {
        return { rows: [{ id: userId, name: 'Admin de teste', email: 'admin@example.com' }], rowCount: 1 };
      }
      if (sql.includes('FROM user_roles ur')) {
        const allowed = permissions.includes(values[1]);
        return { rows: allowed ? [{ allowed: 1 }] : [], rowCount: allowed ? 1 : 0 };
      }
      return queryHandler ? queryHandler(sql, values) : { rows: [], rowCount: 0 };
    },
    async connect() {
      return connectHandler ? connectHandler() : { query: async () => ({ rows: [], rowCount: 0 }), release() {} };
    },
  };
  const app = createApp({
    db,
    config: {
      jwtSecret: secret,
      setupToken: 'test-setup-token-with-more-than-24-chars',
      corsOrigins: ['http://localhost:5173'],
      uploadDir,
    },
  });
  const token = jwt.sign({}, secret, { subject: userId, expiresIn: '8h', algorithm: 'HS256' });
  return { app, token };
}

test('POST /api/v1/admin/uploads valida permissao e formato de imagem antes de salvar', async () => {
  const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'constelacao-upload-'));
  try {
    const denied = makeApp({ uploadDir });
    const unauthorized = await request(denied.app)
      .post('/api/v1/admin/uploads')
      .set('Authorization', `Bearer ${denied.token}`)
      .attach('file', Buffer.from('not an image'), { filename: 'imagem.png', contentType: 'image/png' });
    assert.equal(unauthorized.status, 403);

    const { app, token } = makeApp({ permissions: ['content:manage'], uploadDir });
    const invalid = await request(app)
      .post('/api/v1/admin/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('<svg></svg>'), { filename: 'imagem.png', contentType: 'image/png' });
    assert.equal(invalid.status, 400);

    const missing = await request(app)
      .post('/api/v1/admin/uploads')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(missing.status, 400);

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jpS8AAAAASUVORK5CYII=', 'base64');
    const uploaded = await request(app)
      .post('/api/v1/admin/uploads')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', png, { filename: 'imagem.png', contentType: 'image/png' });
    assert.equal(uploaded.status, 201);
    assert.match(uploaded.body.file.url, /^\/uploads\/[a-f0-9]{32}\.png$/);
    assert.equal(uploaded.body.file.size, png.length);

    const served = await request(app).get(uploaded.body.file.url);
    assert.equal(served.status, 200);
    assert.deepEqual(served.body, png);
  } finally {
    await fs.rm(uploadDir, { recursive: true, force: true });
  }
});

test('POST /api/v1/admin/gallery aceita caminho seguro de imagem enviada', async () => {
  let savedValues;
  const { app, token } = makeApp({
    permissions: ['content:manage'],
    queryHandler: async (sql, values) => {
      if (!sql.includes('INSERT INTO gallery_items')) return { rows: [], rowCount: 0 };
      savedValues = values;
      return { rows: [{ id: 'gallery-id', gallery_name: values[0], image_url: values[3] }], rowCount: 1 };
    },
  });
  const response = await request(app)
    .post('/api/v1/admin/gallery')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Imagem enviada',
      galleryName: 'Workshop',
      description: 'Teste do caminho local.',
      imageUrl: '/uploads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp',
      active: true,
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.item.gallery_name, 'Workshop');
  assert.equal(savedValues[0], 'Workshop');
  assert.equal(response.body.item.image_url, '/uploads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp');
});

test('GET /api/v1/admin/settings exige permissao de configuracao', async () => {
  const { app, token } = makeApp();
  const response = await request(app).get('/api/v1/admin/settings').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 403);
});

test('GET /api/v1/admin/settings devolve valores editaveis para admin', async () => {
  const { app, token } = makeApp({
    permissions: ['settings:manage'],
    queryHandler: async () => ({
      rows: [
        { key: 'site_name', value: 'Site de teste' },
        { key: 'smtp_password_encrypted', value: 'ciphertext-secret' },
      ],
      rowCount: 2,
    }),
  });
  const response = await request(app).get('/api/v1/admin/settings').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.settings.siteName, 'Site de teste');
  assert.equal(response.body.settings.smtpPasswordConfigured, true);
  assert.equal(response.body.settings.smtpPasswordEncrypted, undefined);
  assert.equal(JSON.stringify(response.body).includes('ciphertext-secret'), false);
});

test('PUT /api/v1/admin/settings criptografa senha SMTP e valida configuracao antes de ativar', async () => {
  const writes = [];
  const { app, token } = makeApp({
    permissions: ['settings:manage'],
    connectHandler: () => ({
      async query(sql, values) {
        if (sql.includes('INSERT INTO site_settings')) writes.push({ sql, values });
        if (sql.includes("key = 'smtp_password_encrypted'")) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 1 };
      },
      release() {},
    }),
  });
  const response = await request(app)
    .put('/api/v1/admin/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({
      smtpEnabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: '587',
      smtpSecure: false,
      smtpUser: 'mailer@example.com',
      smtpFrom: 'site@example.com',
      smtpPassword: 'smtp-password-for-test',
    });
  const passwordWrite = writes.find(({ sql }) => sql.includes("'smtp_password_encrypted'"));
  const invalid = await request(app)
    .put('/api/v1/admin/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({
      smtpEnabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: '587',
      smtpSecure: false,
      smtpUser: 'mailer@example.com',
      smtpFrom: 'site@example.com',
    });

  assert.equal(response.status, 200, response.text);
  assert.ok(passwordWrite);
  const encryptedPassword = JSON.parse(passwordWrite.values[0]);
  assert.notEqual(encryptedPassword, 'smtp-password-for-test');
  assert.equal(decryptSmtpPassword(encryptedPassword, secret), 'smtp-password-for-test');
  assert.equal(invalid.status, 400);
});

test('PUT /api/v1/admin/settings persiste somente campos validados', async () => {
  const writes = [];
  const { app, token } = makeApp({
    permissions: ['settings:manage'],
    connectHandler: () => ({
      async query(sql, values) {
        if (sql.includes('INSERT INTO site_settings')) writes.push(values);
        return { rows: [], rowCount: 1 };
      },
      release() {},
    }),
  });
  const response = await request(app)
    .put('/api/v1/admin/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({ siteName: 'Novo nome', primaryColor: '#183f35' });

  assert.equal(response.status, 200);
  assert.deepEqual(writes.map(([key]) => key), ['site_name', 'primary_color']);
});

test('PUT /api/v1/admin/settings aceita configuracoes SEO globais', async () => {
  const writes = [];
  const { app, token } = makeApp({
    permissions: ['settings:manage'],
    connectHandler: () => ({
      async query(sql, values) {
        if (sql.includes('INSERT INTO site_settings')) writes.push(values);
        return { rows: [], rowCount: 1 };
      },
      release() {},
    }),
  });
  const response = await request(app)
    .put('/api/v1/admin/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({
      seoTitle: 'Constelação Familiar | Cursos e encontros',
      seoDescription: 'Descrição pública editável para os mecanismos de busca.',
      seoKeywords: 'constelação familiar, cursos, encontros',
      googleSearchConsoleVerification: 'verification-code',
      ogImageUrl: '/uploads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
    });

  assert.equal(response.status, 200);
  assert.deepEqual(writes.map(([key]) => key), [
    'seo_title', 'seo_description', 'seo_keywords', 'google_search_console_verification', 'og_image_url',
  ]);
});

test('PUT /api/v1/admin/settings salva destinatario e modelos das notificacoes de inscricao', async () => {
  const writes = [];
  const { app, token } = makeApp({
    permissions: ['settings:manage'],
    connectHandler: () => ({
      async query(sql, values) {
        if (sql.includes('INSERT INTO site_settings')) writes.push(values);
        return { rows: [], rowCount: 1 };
      },
      release() {},
    }),
  });
  const response = await request(app)
    .put('/api/v1/admin/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({
      notificationAdminEmail: 'equipe@example.com',
      enrollmentAdminSubject: 'Nova inscricao: {{activity}}',
      enrollmentAdminMessage: 'Inscricao de {{name}} em {{activity}}.',
      enrollmentCustomerSubject: 'Recebemos sua inscricao',
      enrollmentCustomerMessage: 'Ola {{name}}, recebemos sua inscricao para {{activity}}.',
    });
  const invalidSubject = await request(app)
    .put('/api/v1/admin/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({ enrollmentCustomerSubject: ['Assunto', 'invalido'].join('\r\n') });

  assert.equal(response.status, 200);
  assert.deepEqual(writes.map(([key]) => key), [
    'notification_admin_email',
    'enrollment_admin_subject',
    'enrollment_admin_message',
    'enrollment_customer_subject',
    'enrollment_customer_message',
  ]);
  assert.equal(invalidSubject.status, 400);
});

test('PUT /api/v1/admin/settings salva secoes, ordem do menu e imagem do banner', async () => {
  const writes = [];
  const { app, token } = makeApp({
    permissions: ['settings:manage'],
    connectHandler: () => ({
      async query(sql, values) {
        if (sql.includes('INSERT INTO site_settings')) writes.push(values);
        return { rows: [], rowCount: 1 };
      },
      release() {},
    }),
  });
  const response = await request(app)
    .put('/api/v1/admin/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({
      bannerImageUrl: '/uploads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      homepageSections: [{ key: 'hero', active: true, order: 1 }, { key: 'agenda', active: false, order: 2 }],
      menuItems: [{ key: 'courses', label: 'Formações', active: true, order: 1 }],
    });

  assert.equal(response.status, 200);
  assert.deepEqual(writes.map(([key]) => key), ['banner_image_url', 'homepage_sections', 'menu_items']);
  assert.deepEqual(JSON.parse(writes[1][1]), [
    { key: 'hero', active: true, order: 1 },
    { key: 'agenda', active: false, order: 2 },
  ]);
  assert.deepEqual(JSON.parse(writes[2][1]), [{ key: 'courses', label: 'Formações', active: true, order: 1 }]);
});

test('PUT /api/v1/admin/settings rejeita secoes repetidas e rotulos de menu invalidos', async () => {
  const { app, token } = makeApp({ permissions: ['settings:manage'] });
  const repeatedSection = await request(app)
    .put('/api/v1/admin/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({ homepageSections: [{ key: 'hero', active: true, order: 1 }, { key: 'hero', active: false, order: 2 }] });
  const emptyMenuLabel = await request(app)
    .put('/api/v1/admin/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({ menuItems: [{ key: 'home', label: '', active: true, order: 1 }] });

  assert.equal(repeatedSection.status, 400);
  assert.equal(emptyMenuLabel.status, 400);
});

test('POST /api/v1/admin/instructors cria instrutor com permissao valida', async () => {
  const { app, token } = makeApp({
    permissions: ['instructors:manage'],
    queryHandler: async (sql) => sql.includes('INSERT INTO instructors')
      ? { rows: [{ id: 'instructor-id', name: 'Maria Silva', slug: 'maria-silva', active: true }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
  });
  const response = await request(app)
    .post('/api/v1/admin/instructors')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Maria Silva', slug: 'maria-silva', qualifications: 'Facilitadora' });

  assert.equal(response.status, 201);
  assert.equal(response.body.instructor.slug, 'maria-silva');
});

test('POST /api/v1/admin/users e restrito a quem gerencia usuarios', async () => {
  const { app, token } = makeApp();
  const response = await request(app)
    .post('/api/v1/admin/users')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Editor', email: 'editor@example.com', password: 'senha-forte-de-teste', role: 'editor' });
  assert.equal(response.status, 403);
});

test('PATCH /api/v1/admin/users impede desativar a propria conta', async () => {
  const { app, token } = makeApp({ permissions: ['users:manage'] });
  const response = await request(app)
    .patch(`/api/v1/admin/users/${userId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ active: false });
  assert.equal(response.status, 409);
});

test('PATCH /api/v1/admin/users preserva pelo menos um administrador ativo', async () => {
  const { app, token } = makeApp({
    permissions: ['users:manage'],
    connectHandler: () => ({
      async query(sql) {
        if (sql === 'BEGIN' || sql.includes('LOCK TABLE users') || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes('SELECT u.id, u.active')) return { rows: [{ id: userId, active: true, role: 'admin' }], rowCount: 1 };
        if (sql.includes('SELECT COUNT(DISTINCT u.id)')) return { rows: [{ count: 1 }], rowCount: 1 };
        throw new Error('Uma operacao de escrita nao deveria acontecer neste teste.');
      },
      release() {},
    }),
  });
  const response = await request(app)
    .patch('/api/v1/admin/users/22222222-2222-4222-8222-222222222222')
    .set('Authorization', `Bearer ${token}`)
    .send({ active: false });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'Mantenha ao menos um administrador ativo.');
});
