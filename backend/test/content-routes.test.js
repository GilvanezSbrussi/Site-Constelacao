const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

function makeApp() {
  const db = {
    async query(sql) {
      if (sql.includes('FROM blog_posts')) {
        return {
          rows: [{ id: 'blog-id', title: 'Primeiro artigo', slug: 'primeiro-artigo', excerpt: 'Resumo', content: 'Conteudo', image_url: 'https://example.com/image.jpg', published_at: '2026-01-01T12:00:00.000Z' }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM testimonials')) {
        return {
          rows: [{ id: 'testimonial-id', name: 'Ana', role: 'Participante', quote: 'Foi transformador.', avatar_url: 'https://example.com/avatar.jpg' }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM faqs')) {
        return {
          rows: [{ id: 'faq-id', question: 'Como funciona?', answer: 'Em encontros guiados com cuidado.' }],
          rowCount: 1,
        };
      }
      if (sql.includes('FROM gallery_items')) {
        return {
          rows: [{ id: 'gallery-id', gallery_name: 'Workshop', title: 'Foto da sala', description: 'Grupo reunido', image_url: 'https://example.com/gallery.jpg' }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
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

test('GET /api/v1/blog, /testimonials, /faqs e /gallery devolvem conteudos publicos', async () => {
  const app = makeApp();

  const blog = await request(app).get('/api/v1/blog');
  const testimonials = await request(app).get('/api/v1/testimonials');
  const faqs = await request(app).get('/api/v1/faqs');
  const gallery = await request(app).get('/api/v1/gallery');

  assert.equal(blog.status, 200);
  assert.equal(blog.body.posts[0].slug, 'primeiro-artigo');
  assert.equal(testimonials.status, 200);
  assert.equal(testimonials.body.testimonials[0].name, 'Ana');
  assert.equal(faqs.status, 200);
  assert.equal(faqs.body.faqs[0].question, 'Como funciona?');
  assert.equal(gallery.status, 200);
  assert.equal(gallery.body.gallery[0].gallery_name, 'Workshop');
  assert.equal(gallery.body.gallery[0].title, 'Foto da sala');
});
