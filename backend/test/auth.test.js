const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

function makeApp() {
  const db = {
    async query() {
      throw new Error('Banco nao deveria ser consultado neste teste.');
    },
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

test('GET /api/v1/health retorna estado da API', async () => {
  const response = await request(makeApp()).get('/api/v1/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok', service: 'api' });
});

test('GET / serve a pagina inicial', async () => {
  const response = await request(makeApp()).get('/');
  assert.equal(response.status, 200);
  assert.match(response.text, /Um novo olhar/);
});

test('GET /css/site.css e a fonte self-hosted estao disponiveis', async () => {
  const app = makeApp();
  const stylesheet = await request(app).get('/css/site.css');
  const font = await request(app).get('/fonts/manrope-latin-wght-normal.woff2');
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.text, /--forest:/);
  assert.equal(font.status, 200);
  assert.match(font.headers['content-type'], /font\/woff2/);
});

test('GET /api/v1/auth/me exige token Bearer', async () => {
  const response = await request(makeApp()).get('/api/v1/auth/me');
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'Autenticacao necessaria.');
});

test('POST /api/v1/auth/setup rejeita token de configuracao incorreto', async () => {
  const response = await request(makeApp())
    .post('/api/v1/auth/setup')
    .set('x-setup-token', 'token-incorreto')
    .send({ name: 'Admin', email: 'admin@example.com', password: 'senha-segura-com-12' });
  assert.equal(response.status, 403);
});
