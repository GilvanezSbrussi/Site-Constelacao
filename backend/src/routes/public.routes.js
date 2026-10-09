const express = require('express');
const crypto = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { enqueueEnrollmentNotifications } = require('../services/enrollment-notifications');
const { decryptPaymentSecret } = require('../services/mercado-pago-secrets');
const {
  createCheckoutPreference,
  getPayment,
  MercadoPagoError,
  verifyWebhookSignature,
} = require('../services/mercado-pago');

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

function createPublicRouter({ db, config }) {
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
    const enrollmentId = crypto.randomUUID();
    let checkout = null;
    let client;

    try {
      const activityResult = await db.query(
        `SELECT id, title, starts_at, price_cents, promotional_price_cents
         FROM ${targetTable} WHERE id = $1 AND status = 'enrollments_open'`,
        [targetId],
      );
      if (!activityResult.rowCount) {
        return response.status(409).json({ error: 'Inscricoes encerradas ou atividade indisponivel.' });
      }
      const activity = activityResult.rows[0];
      const settingsResult = await db.query(
        `SELECT key, value FROM site_settings
         WHERE key IN ('site_name', 'contact_email', 'notification_admin_email',
           'enrollment_admin_subject', 'enrollment_admin_message',
           'enrollment_customer_subject', 'enrollment_customer_message',
           'payment_enabled', 'payment_access_token_encrypted',
           'payment_environment', 'payment_public_url', 'payment_max_installments')`,
      );
      const siteSettings = Object.fromEntries(settingsResult.rows.map(({ key, value }) => [key, value]));
      const amountCents = activity.promotional_price_cents ?? activity.price_cents;
      const paymentEnabled = Boolean(siteSettings.payment_enabled) && Number.isInteger(amountCents) && amountCents > 0;
      let preference = null;
      if (paymentEnabled) {
        if (!config?.jwtSecret || !siteSettings.payment_access_token_encrypted || !siteSettings.payment_public_url) {
          throw new MercadoPagoError('O pagamento online esta ativado, mas as credenciais ou a URL publica estao incompletas.');
        }
        const publicUrl = new URL(siteSettings.payment_public_url);
        if (siteSettings.payment_environment === 'production' && publicUrl.protocol !== 'https:') {
          throw new MercadoPagoError('A URL publica precisa usar HTTPS no ambiente de producao.');
        }
        const accessToken = decryptPaymentSecret(
          siteSettings.payment_access_token_encrypted,
          config.jwtSecret,
          'access-token',
        );
        preference = await createCheckoutPreference({
          accessToken,
          environment: siteSettings.payment_environment || 'sandbox',
          enrollment: {
            id: enrollmentId,
            name: data.name,
            email: data.email.toLowerCase(),
          },
          activity,
          amountCents,
          publicSiteUrl: publicUrl.toString(),
          maxInstallments: Number(siteSettings.payment_max_installments) || 1,
          fetchImpl: config?.mercadoPagoFetchImpl,
        });
      }

      client = await db.connect();
      await client.query('BEGIN');
      const available = await client.query(
        `UPDATE ${targetTable}
         SET enrolled_count = enrolled_count + 1, updated_at = NOW()
         WHERE id = $1 AND status = 'enrollments_open'
           AND (available_spots IS NULL OR enrolled_count < available_spots)
         RETURNING id, title, starts_at, price_cents, promotional_price_cents`,
        [targetId],
      );

      if (available.rowCount === 0) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: 'Inscricoes encerradas ou sem vagas.' });
      }
      const reservedActivity = available.rows[0];
      const reservedAmountCents = reservedActivity.promotional_price_cents ?? reservedActivity.price_cents;
      if (reservedAmountCents !== amountCents) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: 'O valor da atividade foi atualizado. Recarregue a pagina e tente novamente.' });
      }
      const status = paymentEnabled ? 'awaiting_payment' : 'new';
      const result = await client.query(
        `INSERT INTO enrollments
           (id, ${targetColumn}, name, email, phone, city, state, observations, privacy_consent, status)
         VALUES ($1, $2, $3, LOWER($4), $5, NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), $9, $10)
         RETURNING id, status`,
        [enrollmentId, targetId, data.name, data.email, data.phone, data.city, data.state.toUpperCase(), data.observations, data.privacyConsent, status],
      );
      if (paymentEnabled) {
        await client.query(
          `INSERT INTO enrollment_payments (enrollment_id, preference_id, checkout_url, amount_cents)
           VALUES ($1, $2, $3, $4)`,
          [result.rows[0].id, preference.preferenceId, preference.checkoutUrl, amountCents],
        );
        checkout = { url: preference.checkoutUrl };
      }
      await enqueueEnrollmentNotifications(client, {
        ...data,
        email: data.email.toLowerCase(),
        courseId: data.courseId,
      }, reservedActivity, siteSettings);
      await client.query('COMMIT');
      return response.status(201).json({
        enrollment: result.rows[0],
        ...(checkout ? { payment: checkout } : {}),
      });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      if (error instanceof MercadoPagoError) {
        return response.status(502).json({ error: `Nao foi possivel iniciar o pagamento: ${error.message}` });
      }
      return next(error);
    } finally {
      client?.release();
    }
  });

  router.get('/payments/:enrollmentId/status', async (request, response, next) => {
    if (!z.string().uuid().safeParse(request.params.enrollmentId).success) {
      return response.status(400).json({ error: 'Identificador de inscricao invalido.' });
    }
    try {
      const result = await db.query(
        `SELECT status, amount_cents, currency, checkout_url
         FROM enrollment_payments WHERE enrollment_id = $1`,
        [request.params.enrollmentId],
      );
      if (!result.rowCount) return response.status(404).json({ error: 'Pagamento nao encontrado.' });
      return response.json({ payment: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/payments/webhook', async (request, response, next) => {
    const eventType = request.query.type || request.body?.type || request.body?.topic;
    if (eventType !== 'payment') return response.sendStatus(200);
    const paymentId = String(request.query['data.id'] || request.body?.data?.id || '');
    if (!/^\d{1,30}$/.test(paymentId)) return response.status(400).json({ error: 'Evento de pagamento invalido.' });

    try {
      const secretResult = await db.query(
        "SELECT value FROM site_settings WHERE key = 'payment_webhook_secret_encrypted'",
      );
      const encryptedSecret = secretResult.rows[0]?.value;
      if (!encryptedSecret || !config?.jwtSecret) {
        return response.status(503).json({ error: 'Webhook de pagamento nao configurado.' });
      }
      const secret = decryptPaymentSecret(encryptedSecret, config.jwtSecret, 'webhook-secret');
      const signatureValid = verifyWebhookSignature({
        signature: request.get('x-signature'),
        requestId: request.get('x-request-id'),
        paymentId,
        secret,
      });
      if (!signatureValid) return response.status(401).json({ error: 'Assinatura do webhook invalida.' });

      const settings = await db.query(
        "SELECT value FROM site_settings WHERE key = 'payment_access_token_encrypted'",
      );
      const encryptedToken = settings.rows[0]?.value;
      if (!encryptedToken) return response.status(503).json({ error: 'Acesso ao Mercado Pago nao configurado.' });
      const payment = await getPayment({
        accessToken: decryptPaymentSecret(encryptedToken, config.jwtSecret, 'access-token'),
        paymentId,
        fetchImpl: config?.mercadoPagoFetchImpl,
      });
      if (String(payment.id) !== paymentId) {
        return response.status(400).json({ error: 'Identificador do pagamento nao corresponde ao evento.' });
      }
      const enrollmentId = payment.external_reference;
      if (!z.string().uuid().safeParse(enrollmentId).success || payment.currency_id !== 'BRL') {
        return response.status(400).json({ error: 'Pagamento nao corresponde a uma inscricao valida.' });
      }

      const status = {
        approved: 'approved',
        rejected: 'rejected',
        cancelled: 'cancelled',
        refunded: 'refunded',
        charged_back: 'charged_back',
      }[payment.status] || 'pending';
      let client;
      try {
        client = await db.connect();
        await client.query('BEGIN');
        const enrollmentPayment = await client.query(
          `SELECT ep.amount_cents, ep.status, ep.provider_payment_id, en.status AS enrollment_status
           FROM enrollment_payments ep
           JOIN enrollments en ON en.id = ep.enrollment_id
           WHERE ep.enrollment_id = $1
           FOR UPDATE OF ep, en`,
          [enrollmentId],
        );
        if (!enrollmentPayment.rowCount) {
          await client.query('ROLLBACK');
          return response.status(404).json({ error: 'Inscricao de pagamento nao encontrada.' });
        }
        const amountCents = Number(enrollmentPayment.rows[0].amount_cents);
        const paidAmountCents = Number(payment.transaction_amount) * 100;
        if (!Number.isFinite(paidAmountCents) || Math.round(paidAmountCents) !== amountCents) {
          await client.query('ROLLBACK');
          return response.status(400).json({ error: 'O valor do pagamento nao corresponde a inscricao.' });
        }
        const attempt = await client.query(
          `INSERT INTO enrollment_payment_attempts
             (enrollment_id, provider_payment_id, amount_cents, status, provider_status, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (provider_payment_id) DO UPDATE
           SET status = EXCLUDED.status, provider_status = EXCLUDED.provider_status, updated_at = NOW()
           WHERE enrollment_payment_attempts.enrollment_id = EXCLUDED.enrollment_id
             AND enrollment_payment_attempts.amount_cents = EXCLUDED.amount_cents`,
          [enrollmentId, paymentId, amountCents, status, String(payment.status || '').slice(0, 40)],
        );
        if (!attempt.rowCount) {
          await client.query('ROLLBACK');
          return response.status(409).json({ error: 'O pagamento ja esta vinculado a outra inscricao ou valor.' });
        }
        const isCurrentPayment = enrollmentPayment.rows[0].provider_payment_id === paymentId;
        const canReplacePaymentStatus = ['pending', 'rejected', 'cancelled'].includes(enrollmentPayment.rows[0].status);
        if (status !== 'approved' && !isCurrentPayment && !canReplacePaymentStatus) {
          await client.query('COMMIT');
          return response.sendStatus(200);
        }
        await client.query(
          `UPDATE enrollment_payments
           SET provider_payment_id = $1, status = $2, provider_status = $3, updated_at = NOW()
           WHERE enrollment_id = $4`,
          [String(payment.id), status, String(payment.status || '').slice(0, 40), enrollmentId],
        );
        if (status === 'approved' && enrollmentPayment.rows[0].enrollment_status !== 'cancelled') {
          await client.query(
            "UPDATE enrollments SET status = 'confirmed' WHERE id = $1",
            [enrollmentId],
          );
        }
        await client.query('COMMIT');
        return response.sendStatus(200);
      } catch (error) {
        if (client) await client.query('ROLLBACK');
        throw error;
      } finally {
        client?.release();
      }
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = createPublicRouter;