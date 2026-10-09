const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { enqueueEnrollmentNotifications } = require('../services/enrollment-notifications');

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(30).optional().default(''),
  subject: z.string().trim().min(3).max(160),
  message: z.string().trim().min(10).max(5000),
  privacyConsent: z.literal(true),
});

const enrollmentSchema = z.object({
  courseId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(8).max(30),
  city: z.string().trim().max(100).optional().default(''),
  state: z.string().trim().length(2).optional().default(''),
  observations: z.string().trim().max(1000).optional().default(''),
  privacyConsent: z.literal(true),
}).refine((data) => Boolean(data.courseId) !== Boolean(data.eventId), {
  message: 'Informe um curso ou evento.',
});

function createPublicRouter({ db }) {
  const router = express.Router();
  const formLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5 });

  router.get('/courses', async (request, response, next) => {
    try {
      const result = await db.query(
        `SELECT c.id, c.title, c.slug, c.short_description, c.description, c.image_url, c.modality,
                c.workload_hours, c.starts_at, c.ends_at, c.location, c.available_spots,
                GREATEST(c.available_spots - c.enrolled_count, 0) AS remaining_spots,
                c.price_cents, c.promotional_price_cents, c.status, c.category_id, cc.name AS category_name,
                instructors.items AS instructors, modules.items AS modules
         FROM courses c
         LEFT JOIN course_categories cc ON cc.id = c.category_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(json_agg(json_build_object('id', i.id, 'name', i.name, 'slug', i.slug, 'photo_url', i.photo_url)
                                    ORDER BY i.name), '[]'::json) AS items
           FROM course_instructors ci JOIN instructors i ON i.id = ci.instructor_id
           WHERE ci.course_id = c.id AND i.active = TRUE
         ) instructors ON TRUE
         LEFT JOIN LATERAL (
           SELECT COALESCE(json_agg(json_build_object(
             'id', cm.id, 'title', cm.title, 'description', cm.description,
             'position', cm.position, 'workload_hours', cm.workload_hours
           ) ORDER BY cm.position, cm.created_at), '[]'::json) AS items
           FROM course_modules cm
           WHERE cm.course_id = c.id AND cm.active = TRUE
         ) modules ON TRUE
         WHERE c.status IN ('published', 'enrollments_open')
         ORDER BY c.starts_at NULLS LAST, c.title`,
      );
      return response.json({ courses: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/courses/:slug', async (request, response, next) => {
    try {
      const result = await db.query(
        `SELECT c.id, c.title, c.slug, c.short_description, c.description, c.image_url, c.modality,
                c.workload_hours, c.starts_at, c.ends_at, c.location, c.available_spots,
                GREATEST(c.available_spots - c.enrolled_count, 0) AS remaining_spots,
                c.price_cents, c.promotional_price_cents, c.status, c.category_id, cc.name AS category_name,
                instructors.items AS instructors, modules.items AS modules
         FROM courses c
         LEFT JOIN course_categories cc ON cc.id = c.category_id
         LEFT JOIN LATERAL (
           SELECT COALESCE(json_agg(json_build_object('id', i.id, 'name', i.name, 'slug', i.slug, 'photo_url', i.photo_url)
                                    ORDER BY i.name), '[]'::json) AS items
           FROM course_instructors ci JOIN instructors i ON i.id = ci.instructor_id
           WHERE ci.course_id = c.id AND i.active = TRUE
         ) instructors ON TRUE
         LEFT JOIN LATERAL (
           SELECT COALESCE(json_agg(json_build_object(
             'id', cm.id, 'title', cm.title, 'description', cm.description,
             'position', cm.position, 'workload_hours', cm.workload_hours
           ) ORDER BY cm.position, cm.created_at), '[]'::json) AS items
           FROM course_modules cm
           WHERE cm.course_id = c.id AND cm.active = TRUE
         ) modules ON TRUE
         WHERE c.slug = $1 AND c.status IN ('published', 'enrollments_open')`,
        [request.params.slug],
      );
      if (result.rowCount === 0) return response.status(404).json({ error: 'Curso nao encontrado.' });
      return response.json({ course: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/instructors', async (request, response, next) => {
    try {
      const result = await db.query(
        `SELECT id, name, slug, biography, qualifications, specialties, photo_url, instagram_url, website_url
         FROM instructors WHERE active = TRUE ORDER BY name`,
      );
      return response.json({ instructors: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/settings', async (request, response, next) => {
    try {
      const result = await db.query(`
        SELECT key, value FROM site_settings
        WHERE key IN ('site_name', 'tagline', 'banner_title', 'banner_subtitle', 'contact_email', 'phone',
          'whatsapp_number', 'whatsapp_message', 'address', 'instagram_url', 'facebook_url', 'tiktok_url',
          'youtube_url', 'linkedin_url', 'primary_color', 'secondary_color', 'seo_title', 'seo_description',
          'seo_keywords', 'google_search_console_verification', 'og_image_url', 'banner_image_url',
          'homepage_sections', 'menu_items')
      `);
      const settings = Object.fromEntries(result.rows.map(({ key, value }) => [key, value]));
      return response.json({ settings });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/events', async (request, response, next) => {
    try {
      const result = await db.query(
        `SELECT id, title, slug, short_description, description, image_url, modality,
                starts_at, ends_at, location, available_spots,
                GREATEST(available_spots - enrolled_count, 0) AS remaining_spots,
                price_cents, promotional_price_cents, status
         FROM events
         WHERE status IN ('published', 'enrollments_open')
         ORDER BY starts_at NULLS LAST, title`,
      );
      return response.json({ events: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/events/:slug', async (request, response, next) => {
    try {
      const result = await db.query(
        `SELECT id, title, slug, short_description, description, image_url, modality,
                starts_at, ends_at, location, available_spots,
                GREATEST(available_spots - enrolled_count, 0) AS remaining_spots,
                price_cents, promotional_price_cents, status
         FROM events
         WHERE slug = $1 AND status IN ('published', 'enrollments_open')`,
        [request.params.slug],
      );
      if (result.rowCount === 0) return response.status(404).json({ error: 'Evento nao encontrado.' });
      return response.json({ event: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/blog', async (request, response, next) => {
    try {
      const result = await db.query(
        `SELECT id, title, slug, excerpt, content, image_url, published_at
         FROM blog_posts
         WHERE active = TRUE
         ORDER BY published_at DESC, created_at DESC`,
      );
      return response.json({ posts: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/blog/:slug', async (request, response, next) => {
    try {
      const result = await db.query(
        `SELECT id, title, slug, excerpt, content, image_url, published_at
         FROM blog_posts
         WHERE slug = $1 AND active = TRUE AND published_at <= NOW()`,
        [request.params.slug],
      );
      if (result.rowCount === 0) return response.status(404).json({ error: 'Artigo nao encontrado.' });
      return response.json({ post: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/testimonials', async (request, response, next) => {
    try {
      const result = await db.query(
        `SELECT id, name, role, quote, avatar_url
         FROM testimonials
         WHERE active = TRUE
         ORDER BY created_at DESC`,
      );
      return response.json({ testimonials: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/faqs', async (request, response, next) => {
    try {
      const result = await db.query(
        `SELECT id, question, answer
         FROM faqs
         WHERE active = TRUE
         ORDER BY created_at ASC`,
      );
      return response.json({ faqs: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/gallery', async (request, response, next) => {
    try {
      const result = await db.query(
        `SELECT id, gallery_name, title, description, image_url
         FROM gallery_items
         WHERE active = TRUE
         ORDER BY gallery_name, created_at DESC`,
      );
      return response.json({ gallery: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/contacts', formLimiter, async (request, response, next) => {
    const parsed = contactSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: 'Confira os campos e aceite a politica de privacidade.' });
    }

    try {
      const { name, email, phone, subject, message, privacyConsent } = parsed.data;
      const result = await db.query(
        `INSERT INTO contacts (name, email, phone, subject, message, privacy_consent)
         VALUES ($1, LOWER($2), NULLIF($3, ''), $4, $5, $6)
         RETURNING id, status`,
        [name, email, phone, subject, message, privacyConsent],
      );
      return response.status(201).json({ contact: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/enrollments', formLimiter, async (request, response, next) => {
    const parsed = enrollmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return response.status(400).json({ error: 'Confira os campos, escolha um curso ou evento e aceite a politica de privacidade.' });
    }

    const data = parsed.data;
    const targetTable = data.courseId ? 'courses' : 'events';
    const targetColumn = data.courseId ? 'course_id' : 'event_id';
    const targetId = data.courseId || data.eventId;
    let client;

    try {
      client = await db.connect();
      await client.query('BEGIN');
      const available = await client.query(
        `UPDATE ${targetTable}
         SET enrolled_count = enrolled_count + 1, updated_at = NOW()
         WHERE id = $1 AND status = 'enrollments_open'
           AND (available_spots IS NULL OR enrolled_count < available_spots)
         RETURNING id, title, starts_at`,
        [targetId],
      );

      if (available.rowCount === 0) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: 'Inscricoes encerradas ou sem vagas.' });
      }

      const result = await client.query(
        `INSERT INTO enrollments
           (${targetColumn}, name, email, phone, city, state, observations, privacy_consent)
         VALUES ($1, $2, LOWER($3), $4, NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), $8)
         RETURNING id, status`,
        [targetId, data.name, data.email, data.phone, data.city, data.state.toUpperCase(), data.observations, data.privacyConsent],
      );
      const settingsResult = await client.query(
        `SELECT key, value FROM site_settings
         WHERE key IN ('site_name', 'contact_email', 'notification_admin_email',
           'enrollment_admin_subject', 'enrollment_admin_message',
           'enrollment_customer_subject', 'enrollment_customer_message')`,
      );
      const siteSettings = Object.fromEntries(settingsResult.rows.map(({ key, value }) => [key, value]));
      await enqueueEnrollmentNotifications(client, {
        ...data,
        email: data.email.toLowerCase(),
        courseId: data.courseId,
      }, available.rows[0], siteSettings);
      await client.query('COMMIT');
      return response.status(201).json({ enrollment: result.rows[0] });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      return next(error);
    } finally {
      client?.release();
    }
  });

  return router;
}

module.exports = createPublicRouter;