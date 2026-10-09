const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

function makeApp(overrides = {}) {
  const db = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
    ...overrides,
  };
  return createApp({
    db,
    config: {
      jwtSecret: 'test-secret-with-at-least-thirty-two-characters',
      setupToken: 'test-setup-token-with-more-than-24-chars',
      corsOrigins: ['http://localhost:5173'],
    },
  });
}

test('GET /api/v1/courses e /events devolvem listas publicas', async () => {
  const app = makeApp();
  const courses = await request(app).get('/api/v1/courses');
  const events = await request(app).get('/api/v1/events');

  assert.deepEqual(courses.body, { courses: [] });
  assert.deepEqual(events.body, { events: [] });
});

test('GET paginas publicas de artigos e detalhes estao disponiveis', async () => {
  const app = makeApp();
  const blog = await request(app).get('/blog.html');
  const article = await request(app).get('/artigo.html');
  const activity = await request(app).get('/atividade.html');
  const courses = await request(app).get('/cursos.html');
  const events = await request(app).get('/eventos.html');
  const contact = await request(app).get('/contato.html');
  const home = await request(app).get('/');

  assert.equal(blog.status, 200);
  assert.match(blog.text, /data-blog-list/);
  assert.equal(article.status, 200);
  assert.match(article.text, /data-blog-detail/);
  assert.equal(activity.status, 200);
  assert.match(activity.text, /data-activity-detail/);
  for (const page of [courses, events, contact, home]) {
    assert.equal(page.status, 200);
    assert.match(page.text, /href="\/blog\.html"/);
  }
});

test('GET /api/v1/courses, /events e /blog por slug retorna detalhes publicados', async () => {
  const app = makeApp({
    async query(sql, values) {
      if (sql.includes('FROM courses c') && sql.includes('c.slug = $1')) {
        return {
          rows: [{
            id: 'course-id',
            slug: values[0],
            title: 'Curso',
            category_name: 'Formação',
            instructors: [],
            modules: [{ id: 'module-id', title: 'Fundamentos', position: 1, workload_hours: 4 }],
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM events') && sql.includes('slug = $1')) {
        return { rows: [{ id: 'event-id', slug: values[0], title: 'Evento' }], rowCount: 1 };
      }
      if (sql.includes('FROM blog_posts') && sql.includes('slug = $1')) {
        return { rows: [{ id: 'post-id', slug: values[0], title: 'Artigo' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  });

  const course = await request(app).get('/api/v1/courses/formacao');
  const event = await request(app).get('/api/v1/events/encontro');
  const post = await request(app).get('/api/v1/blog/relacoes');

  assert.equal(course.status, 200);
  assert.equal(course.body.course.slug, 'formacao');
  assert.equal(course.body.course.category_name, 'Formação');
  assert.deepEqual(course.body.course.instructors, []);
  assert.equal(course.body.course.modules[0].title, 'Fundamentos');
  assert.equal(event.status, 200);
  assert.equal(event.body.event.slug, 'encontro');
  assert.equal(post.status, 200);
  assert.equal(post.body.post.slug, 'relacoes');
});

test('GET detalhes publicos retorna 404 para slugs indisponiveis', async () => {
  const app = makeApp();

  const course = await request(app).get('/api/v1/courses/nao-publicado');
  const event = await request(app).get('/api/v1/events/nao-publicado');
  const post = await request(app).get('/api/v1/blog/nao-publicado');

  assert.equal(course.status, 404);
  assert.equal(event.status, 404);
  assert.equal(post.status, 404);
});

test('GET /api/v1/settings e /instructors publicam apenas os dados configurados', async () => {
  let settingsQuery = '';
  const app = makeApp({
    async query(sql) {
      if (sql.includes('FROM site_settings')) {
        settingsQuery = sql;
        return {
          rows: [
            { key: 'site_name', value: 'Site de teste' },
            { key: 'seo_description', value: 'Descrição para buscadores' },
            { key: 'google_search_console_verification', value: 'verification-code' },
            { key: 'homepage_sections', value: [{ key: 'hero', active: true, order: 1 }] },
            { key: 'menu_items', value: [{ key: 'courses', label: 'Formações', active: true, order: 1 }] },
          ],
          rowCount: 5,
        };
      }
      if (sql.includes('FROM instructors')) return { rows: [{ id: 'instructor-id', name: 'Instrutora de teste' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  });
  const settings = await request(app).get('/api/v1/settings');
  const instructors = await request(app).get('/api/v1/instructors');

  assert.equal(settings.body.settings.site_name, 'Site de teste');
  assert.equal(settings.body.settings.seo_description, 'Descrição para buscadores');
  assert.equal(settings.body.settings.google_search_console_verification, 'verification-code');
  assert.deepEqual(settings.body.settings.homepage_sections, [{ key: 'hero', active: true, order: 1 }]);
  assert.deepEqual(settings.body.settings.menu_items, [{ key: 'courses', label: 'Formações', active: true, order: 1 }]);
  assert.doesNotMatch(settingsQuery, /notification_admin_email|enrollment_(admin|customer)_(subject|message)/);
  assert.equal(instructors.body.instructors[0].name, 'Instrutora de teste');
});

test('POST /api/v1/contacts exige consentimento de privacidade', async () => {
  const response = await request(makeApp())
    .post('/api/v1/contacts')
    .send({ name: 'Ana Silva', email: 'ana@example.com', subject: 'Duvida', message: 'Gostaria de mais informacoes.' });

  assert.equal(response.status, 400);
});

test('POST /api/v1/contacts registra somente dados validados', async () => {
  let insertedValues;
  const app = makeApp({
    async query(sql, values) {
      insertedValues = values;
      return { rows: [{ id: 'contact-id', status: 'new' }], rowCount: 1 };
    },
  });
  const response = await request(app)
    .post('/api/v1/contacts')
    .send({
      name: 'Ana Silva',
      email: 'ANA@example.com',
      subject: 'Duvida',
      message: 'Gostaria de mais informacoes.',
      privacyConsent: true,
    });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body.contact, { id: 'contact-id', status: 'new' });
  assert.equal(insertedValues[1], 'ANA@example.com');
  assert.equal(insertedValues[5], true);
});

test('POST /api/v1/enrollments rejeita formularios invalidos sem consultar o banco', async () => {
  const response = await request(makeApp())
    .post('/api/v1/enrollments')
    .send({ name: 'Ana Silva', email: 'ana@example.com', phone: '47999999999' });

  assert.equal(response.status, 400);
});

test('POST /api/v1/enrollments reserva vaga sem exceder a capacidade', async () => {
  const calls = [];
  const notifications = [];
  const app = makeApp({
    async connect() {
      return {
        async query(sql, values = []) {
          calls.push(sql.trim().split(/\s+/)[0]);
          if (sql.includes('UPDATE courses')) {
            return { rows: [{ id: 'course-id', title: 'Formacao', starts_at: '2026-11-10T12:00:00.000Z' }], rowCount: 1 };
          }
          if (sql.includes('INSERT INTO enrollments')) {
            return { rows: [{ id: 'enrollment-id', status: 'new' }], rowCount: 1 };
          }
          if (sql.includes('FROM site_settings')) {
            return {
              rows: [
                { key: 'site_name', value: 'Constelacao' },
                { key: 'notification_admin_email', value: 'equipe@example.com' },
                { key: 'enrollment_admin_subject', value: 'Nova inscricao: {{activity}}' },
                { key: 'enrollment_admin_message', value: '{{name}} / {{email}} / {{activity}} / {{type}}' },
                { key: 'enrollment_customer_subject', value: 'Recebemos: {{activity}}' },
                { key: 'enrollment_customer_message', value: 'Ola {{name}}, {{siteName}} confirmou {{activity}}.' },
              ],
              rowCount: 6,
            };
          }
          if (sql.includes('INSERT INTO notification_outbox')) {
            notifications.push(values);
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
  });
  const response = await request(app)
    .post('/api/v1/enrollments')
    .send({
      courseId: '11111111-1111-4111-8111-111111111111',
      name: 'Ana Silva',
      email: 'ana@example.com',
      phone: '47999999999',
      privacyConsent: true,
    });

  assert.equal(response.status, 201);
  assert.deepEqual(response.body.enrollment, { id: 'enrollment-id', status: 'new' });
  assert.deepEqual(calls, ['BEGIN', 'UPDATE', 'INSERT', 'SELECT', 'INSERT', 'INSERT', 'COMMIT']);
  assert.deepEqual(notifications, [
    ['admin', 'equipe@example.com', 'Nova inscricao: Formacao', 'Ana Silva / ana@example.com / Formacao / Curso'],
    ['customer', 'ana@example.com', 'Recebemos: Formacao', 'Ola Ana Silva, Constelacao confirmou Formacao.'],
  ]);
});

test('POST /api/v1/enrollments encerra transacao quando nao ha vaga', async () => {
  const calls = [];
  const app = makeApp({
    async connect() {
      return {
        async query(sql) {
          calls.push(sql.trim().split(/\s+/)[0]);
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };
    },
  });
  const response = await request(app)
    .post('/api/v1/enrollments')
    .send({
      eventId: '22222222-2222-4222-8222-222222222222',
      name: 'Ana Silva',
      email: 'ana@example.com',
      phone: '47999999999',
      privacyConsent: true,
    });

  assert.equal(response.status, 409);
  assert.deepEqual(calls, ['BEGIN', 'UPDATE', 'ROLLBACK']);
});