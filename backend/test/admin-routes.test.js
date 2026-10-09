const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { createApp } = require('../src/app');

const secret = 'test-secret-with-at-least-thirty-two-characters';
const userId = '11111111-1111-4111-8111-111111111111';

function makeApp({ permissions = [], queryHandler, connectHandler } = {}) {
  const db = {
    async query(sql, values) {
      if (sql.includes('FROM users WHERE id')) {
        return { rows: [{ id: userId, name: 'Admin de teste', email: 'admin@example.com' }], rowCount: 1 };
      }
      if (sql.includes('FROM user_roles ur')) {
        return { rows: permissions.includes(values[1]) ? [{ '?column?': 1 }] : [], rowCount: permissions.includes(values[1]) ? 1 : 0 };
      }
      if (queryHandler) return queryHandler(sql, values);
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      if (connectHandler) return connectHandler();
      throw new Error('Este teste nao deveria abrir uma transacao.');
    },
  };
  const app = createApp({
    db,
    config: {
      jwtSecret: secret,
      setupToken: 'test-setup-token-with-more-than-24-chars',
      corsOrigins: ['http://localhost:5173'],
    },
  });
  const token = jwt.sign({}, secret, { subject: userId, expiresIn: '8h', algorithm: 'HS256' });
  return { app, token };
}

test('GET /api/v1/admin/dashboard exige autenticacao', async () => {
  const { app } = makeApp();
  const response = await request(app).get('/api/v1/admin/dashboard');
  assert.equal(response.status, 401);
});

test('GET /api/v1/admin/courses exige permissao de cursos', async () => {
  const { app, token } = makeApp();
  const response = await request(app).get('/api/v1/admin/courses').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 403);
});

test('GET /api/v1/admin/courses inclui categoria e instrutores sem erro de agrupamento', async () => {
  let sqlReceived = '';
  const { app, token } = makeApp({
    permissions: ['courses:manage'],
    queryHandler: async (sql) => {
      sqlReceived = sql;
      return { rows: [{ id: 'course-id', category_name: 'Formação', instructor_ids: [] }], rowCount: 1 };
    },
  });
  const response = await request(app).get('/api/v1/admin/courses').set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.courses[0].category_name, 'Formação');
  assert.match(sqlReceived, /GROUP BY c\.id,\s*cc\.name/);
});

test('GET /api/v1/admin/dashboard retorna metricas autenticadas', async () => {
  const { app, token } = makeApp({
    queryHandler: async () => ({
      rows: [{ courses: 3, events: 2, enrollments: 18, new_contacts: 1, new_enrollments: 4 }],
      rowCount: 1,
    }),
  });
  const response = await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.metrics.new_enrollments, 4);
});

test('POST /api/v1/admin/courses validates and creates a course', async () => {
  const { app, token } = makeApp({
    permissions: ['courses:manage'],
    queryHandler: async (sql) => sql.includes('INSERT INTO courses')
      ? { rows: [{ id: 'course-id', title: 'Curso de teste', status: 'draft' }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
  });
  const response = await request(app)
    .post('/api/v1/admin/courses')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Curso de teste',
      slug: 'curso-de-teste',
      shortDescription: 'Descricao curta.',
      description: 'Descricao completa.',
      modality: 'online',
      status: 'draft',
      workloadHours: null,
      startsAt: null,
      endsAt: null,
      imageUrl: '/uploads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      location: null,
      availableSpots: null,
      priceCents: null,
      promotionalPriceCents: null,
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.course.slug, undefined);
  assert.equal(response.body.course.title, 'Curso de teste');
});

test('GET e POST /api/v1/admin/course-categories exigem permissao e validam slug', async () => {
  const denied = makeApp();
  const { token: deniedToken } = denied;
  const deniedResponse = await request(denied.app)
    .get('/api/v1/admin/course-categories')
    .set('Authorization', `Bearer ${deniedToken}`);
  assert.equal(deniedResponse.status, 403);

  const { app, token } = makeApp({
    permissions: ['courses:manage'],
    queryHandler: async (sql) => sql.includes('INSERT INTO course_categories')
      ? { rows: [{ id: 'category-id', name: 'Formação', slug: 'formacao', active: true }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
  });
  const created = await request(app)
    .post('/api/v1/admin/course-categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Formação', slug: 'formacao', description: 'Cursos de formação.' });
  const invalid = await request(app)
    .post('/api/v1/admin/course-categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Formação', slug: 'Slug inválido!' });

  assert.equal(created.status, 201);
  assert.equal(created.body.category.slug, 'formacao');
  assert.equal(invalid.status, 400);
});

test('PUT /api/v1/admin/courses preserva vinculo com categoria inativa existente', async () => {
  const courseId = '44444444-4444-4444-8444-444444444444';
  const categoryId = '55555555-5555-4555-8555-555555555555';
  const queries = [];
  const { app, token } = makeApp({
    permissions: ['courses:manage'],
    queryHandler: async (sql, values) => {
      queries.push({ sql, values });
      if (sql.includes('FROM course_categories')) return { rows: [{ id: categoryId }], rowCount: 1 };
      if (sql.includes('UPDATE courses')) return { rows: [{ id: courseId, category_id: categoryId }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  });
  const response = await request(app)
    .put(`/api/v1/admin/courses/${courseId}`)
    .auth(token, { type: 'bearer' })
    .send({
      title: 'Curso de teste',
      slug: 'curso-de-teste',
      shortDescription: 'Descricao curta.',
      description: 'Descricao completa.',
      modality: 'online',
      status: 'draft',
      workloadHours: null,
      categoryId,
      startsAt: null,
      endsAt: null,
      imageUrl: '/uploads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png',
      location: null,
      availableSpots: null,
      priceCents: null,
      promotionalPriceCents: null,
    });

  assert.equal(response.status, 200);
  assert.match(queries[0].sql, /active = TRUE OR id = \(SELECT category_id FROM courses WHERE id = \$2\)/);
  assert.deepEqual(queries[0].values, [categoryId, courseId]);
});

test('POST /api/v1/admin/courses/:id/modules cria modulo validado', async () => {
  const { app, token } = makeApp({
    permissions: ['courses:manage'],
    queryHandler: async (sql, values) => sql.includes('INSERT INTO course_modules')
      ? { rows: [{ id: 'module-id', course_id: values[0], title: values[1], position: values[3], active: values[5] }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
  });
  const created = await request(app)
    .post(`/api/v1/admin/courses/${userId}/modules`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Fundamentos', description: 'Conceitos introdutórios.', position: 1, workloadHours: 4 });
  const invalid = await request(app)
    .post(`/api/v1/admin/courses/${userId}/modules`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: '', position: 0 });

  assert.equal(created.status, 201);
  assert.equal(created.body.module.title, 'Fundamentos');
  assert.equal(created.body.module.position, 1);
  assert.equal(invalid.status, 400);
});

test('DELETE /api/v1/admin/courses arquiva sem excluir o registro', async () => {
  let sqlReceived = '';
  const { app, token } = makeApp({
    permissions: ['courses:manage'],
    queryHandler: async (sql) => {
      sqlReceived = sql;
      return { rows: [{ id: userId }], rowCount: 1 };
    },
  });
  const response = await request(app)
    .delete(`/api/v1/admin/courses/${userId}`)
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 204);
  assert.match(sqlReceived, /SET status = 'cancelled'/);
  assert.doesNotMatch(sqlReceived, /DELETE FROM/i);
});

test('PUT /api/v1/admin/courses/:id/instructors salva vinculos em uma transacao', async () => {
  const calls = [];
  const { app, token } = makeApp({
    permissions: ['courses:manage'],
    connectHandler: () => ({
      async query(sql) {
        calls.push(sql.trim().split(/\s+/)[0]);
        if (sql.includes('SELECT id FROM courses')) return { rows: [{ id: 'course-id' }], rowCount: 1 };
        if (sql.includes('SELECT id FROM instructors')) return { rows: [{ id: 'instructor-id' }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      },
      release() {},
    }),
  });
  const response = await request(app)
    .put('/api/v1/admin/courses/22222222-2222-4222-8222-222222222222/instructors')
    .set('Authorization', `Bearer ${token}`)
    .send({ instructorIds: ['33333333-3333-4333-8333-333333333333'] });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ['BEGIN', 'SELECT', 'SELECT', 'DELETE', 'INSERT', 'COMMIT']);
});