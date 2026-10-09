const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { z } = require('zod');
const { createAuthenticate, createRequirePermission } = require('../middleware/auth');
const { encryptSmtpPassword } = require('../services/smtp-secrets');

const idSchema = z.string().uuid();
const uploadedImagePath = /^\/uploads\/[a-f0-9]{32}\.(?:jpg|png|webp)$/;
const isHttpsUrl = (value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};
const optionalUrl = z.union([
  z.string().url().max(2000).refine(isHttpsUrl),
  z.string().regex(uploadedImagePath),
  z.literal(''),
  z.null(),
]).optional().transform((value) => value || null);
const emailOrEmpty = z.union([z.string().trim().email().max(254), z.literal('')]).optional().transform((value) => value || null);

const instructorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  biography: z.string().trim().max(10_000).optional().default(''),
  qualifications: z.string().trim().max(2000).optional().default(''),
  specialties: z.string().trim().max(2000).optional().default(''),
  photoUrl: optionalUrl,
  instagramUrl: optionalUrl,
  websiteUrl: optionalUrl,
  email: emailOrEmpty,
  active: z.boolean().optional().default(true),
});

const settingsFields = {
  siteName: z.string().trim().min(2).max(120),
  tagline: z.string().trim().max(240),
  bannerTitle: z.string().trim().max(180),
  bannerSubtitle: z.string().trim().max(500),
  bannerImageUrl: optionalUrl,
  contactEmail: emailOrEmpty,
  notificationAdminEmail: emailOrEmpty,
  enrollmentAdminSubject: z.string().trim().min(1).max(180).refine((value) => !/[\r\n]/.test(value)),
  enrollmentAdminMessage: z.string().trim().min(1).max(4000),
  enrollmentCustomerSubject: z.string().trim().min(1).max(180).refine((value) => !/[\r\n]/.test(value)),
  enrollmentCustomerMessage: z.string().trim().min(1).max(4000),
  smtpEnabled: z.boolean(),
  smtpHost: z.string().trim().max(255),
  smtpPort: z.preprocess(
    (value) => value === '' ? undefined : typeof value === 'string' ? Number(value) : value,
    z.number().int().min(1).max(65535).optional(),
  ),
  smtpSecure: z.boolean(),
  smtpUser: z.string().trim().max(254),
  smtpFrom: emailOrEmpty,
  phone: z.string().trim().max(30),
  whatsappNumber: z.string().trim().max(30),
  whatsappMessage: z.string().trim().max(300),
  address: z.string().trim().max(300),
  instagramUrl: optionalUrl,
  facebookUrl: optionalUrl,
  tiktokUrl: optionalUrl,
  youtubeUrl: optionalUrl,
  linkedinUrl: optionalUrl,
  seoTitle: z.string().trim().max(180),
  seoDescription: z.string().trim().max(320),
  seoKeywords: z.string().trim().max(500),
  googleSearchConsoleVerification: z.string().trim().max(200).regex(/^[A-Za-z0-9_-]*$/),
  ogImageUrl: optionalUrl,
  primaryColor: z.string().regex(/^#[\da-fA-F]{6}$/),
  secondaryColor: z.string().regex(/^#[\da-fA-F]{6}$/),
};
const settingsSchema = z.object(settingsFields).partial().refine((settings) => Object.keys(settings).length > 0, {
  message: 'Informe ao menos uma configuracao.',
});
const homepageSectionsSchema = z.array(z.object({
  key: z.enum(['hero', 'approach', 'agenda', 'about', 'content', 'testimonials', 'faq', 'instructors', 'contact']),
  active: z.boolean(),
  order: z.number().int().min(1).max(20),
})).max(9).refine((items) => new Set(items.map((item) => item.key)).size === items.length, {
  message: 'As secoes nao podem se repetir.',
});
const menuItemsSchema = z.array(z.object({
  key: z.enum(['home', 'approach', 'courses', 'events', 'about', 'blog', 'contact']),
  label: z.string().trim().min(1).max(40),
  active: z.boolean(),
  order: z.number().int().min(1).max(20),
})).max(7).refine((items) => new Set(items.map((item) => item.key)).size === items.length, {
  message: 'Os itens do menu nao podem se repetir.',
});
const structuredSettingsSchema = z.object({
  homepageSections: homepageSectionsSchema.optional(),
  menuItems: menuItemsSchema.optional(),
}).partial();

const userSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
  role: z.enum(['admin', 'editor', 'attendant']),
});

const userUpdateSchema = z.object({
  active: z.boolean().optional(),
  role: z.enum(['admin', 'editor', 'attendant']).optional(),
}).refine((changes) => Object.keys(changes).length > 0, { message: 'Informe o perfil ou estado do usuario.' });

const settingKeys = Object.fromEntries(Object.keys(settingsFields).map((camel) => [
  camel,
  camel.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
]));

function respondInvalid(response, message, result) {
  return response.status(400).json({ error: message, details: result.error.flatten() });
}

function createAdminManagementRouter({ db, config }) {
  const router = express.Router();
  router.use(createAuthenticate({ db, jwtSecret: config.jwtSecret }));
  const requirePermission = createRequirePermission({ db });
  const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30 });
  const uploadImage = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  }).single('file');

  router.post('/uploads', uploadLimiter, requirePermission('content:manage'), (request, response, next) => {
    uploadImage(request, response, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return response.status(413).json({ error: 'A imagem deve ter no maximo 8 MB.' });
      }
      return response.status(400).json({ error: 'Envie um unico arquivo de imagem valido.' });
    });
  }, async (request, response, next) => {
    if (!request.file) return response.status(400).json({ error: 'Selecione uma imagem para enviar.' });

    const { buffer, mimetype } = request.file;
    const formats = [
      { mime: 'image/jpeg', extension: 'jpg', matches: () => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
      { mime: 'image/png', extension: 'png', matches: () => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
      { mime: 'image/webp', extension: 'webp', matches: () => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' },
    ];
    const format = formats.find((candidate) => candidate.mime === mimetype && candidate.matches());
    if (!format) return response.status(400).json({ error: 'Formato de imagem nao aceito. Use JPEG, PNG ou WebP.' });

    const filename = `${crypto.randomBytes(16).toString('hex')}.${format.extension}`;
    const uploadDir = path.resolve(config.uploadDir || path.resolve(__dirname, '../../uploads'));
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      await fs.writeFile(path.join(uploadDir, filename), buffer, { flag: 'wx', mode: 0o644 });
      return response.status(201).json({
        file: { url: `/uploads/${filename}`, mimeType: format.mime, size: buffer.length },
      });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/settings', requirePermission('settings:manage'), async (request, response, next) => {
    try {
      const result = await db.query('SELECT key, value FROM site_settings ORDER BY key');
      const settings = Object.fromEntries(result.rows.map(({ key, value }) => [
        key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()),
        value,
      ]));
      settings.smtpPasswordConfigured = Boolean(settings.smtpPasswordEncrypted);
      delete settings.smtpPasswordEncrypted;
      return response.json({ settings });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/settings', requirePermission('settings:manage'), async (request, response, next) => {
    const basicSettings = {};
    const structuredSettings = {};
    for (const [key, value] of Object.entries(request.body || {})) {
      if (key === 'homepageSections' || key === 'menuItems') structuredSettings[key] = value;
      else basicSettings[key] = value;
    }
    const smtpPassword = basicSettings.smtpPassword;
    delete basicSettings.smtpPassword;
    const passwordParsed = smtpPassword === undefined
      ? { success: true, data: undefined }
      : z.string().max(512).safeParse(smtpPassword);
    if (!passwordParsed.success) return respondInvalid(response, 'A senha SMTP informada e invalida.', passwordParsed);
    const basicParsed = Object.keys(basicSettings).length
      ? settingsSchema.safeParse(basicSettings)
      : { success: true, data: {} };
    if (!basicParsed.success) return respondInvalid(response, 'Revise as configuracoes informadas.', basicParsed);
    const structuredParsed = structuredSettingsSchema.safeParse(structuredSettings);
    if (!structuredParsed.success) return respondInvalid(response, 'Revise as secoes e itens do menu.', structuredParsed);
    const parsedSettings = { ...basicParsed.data, ...structuredParsed.data };
    const settingsToSave = { ...parsedSettings };
    delete settingsToSave.smtpPort;
    const valuesToSave = { ...settingsToSave };

    let client;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      if (parsedSettings.smtpEnabled) {
        const existingPassword = passwordParsed.data
          ? null
          : await client.query("SELECT value FROM site_settings WHERE key = 'smtp_password_encrypted'");
        if (!passwordParsed.data && !existingPassword?.rows[0]?.value) {
          await client.query('ROLLBACK');
          return response.status(400).json({ error: 'Informe a senha SMTP antes de ativar o envio.' });
        }
        if (!parsedSettings.smtpHost || !parsedSettings.smtpPort || !parsedSettings.smtpUser || !parsedSettings.smtpFrom) {
          await client.query('ROLLBACK');
          return response.status(400).json({ error: 'Informe servidor, porta, usuário e remetente SMTP antes de ativar o envio.' });
        }
      }
      for (const [field, value] of Object.entries(valuesToSave)) {
        await client.query(
          `INSERT INTO site_settings (key, value, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [settingKeys[field] || field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), JSON.stringify(value)],
        );
      }
      if (parsedSettings.smtpPort !== undefined) {
        await client.query(
          `INSERT INTO site_settings (key, value, updated_at)
           VALUES ('smtp_port', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(parsedSettings.smtpPort)],
        );
      }
      if (passwordParsed.data) {
        await client.query(
          `INSERT INTO site_settings (key, value, updated_at)
           VALUES ('smtp_password_encrypted', $1::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [JSON.stringify(encryptSmtpPassword(passwordParsed.data, config.jwtSecret))],
        );
      }
      await client.query('COMMIT');
      return response.json({ saved: Object.keys(valuesToSave).length + Number(parsedSettings.smtpPort !== undefined) + Number(Boolean(passwordParsed.data)) });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      return next(error);
    } finally {
      client?.release();
    }
  });

  const blogSchema = z.object({
    title: z.string().trim().min(3).max(180),
    slug: z.string().trim().min(3).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    excerpt: z.string().trim().min(3).max(300),
    content: z.string().trim().min(10).max(25_000),
    imageUrl: optionalUrl,
    publishedAt: z.string().datetime({ offset: true }).nullable().optional(),
    active: z.boolean().optional().default(true),
  });

  const testimonialSchema = z.object({
    name: z.string().trim().min(2).max(120),
    role: z.string().trim().max(120).optional().default(''),
    quote: z.string().trim().min(15).max(1000),
    avatarUrl: optionalUrl,
    active: z.boolean().optional().default(true),
  });

  const faqSchema = z.object({
    question: z.string().trim().min(5).max(200),
    answer: z.string().trim().min(10).max(4000),
    active: z.boolean().optional().default(true),
  });

  const gallerySchema = z.object({
    galleryName: z.string().trim().min(2).max(120).optional().default('Galeria geral'),
    title: z.string().trim().min(2).max(180),
    description: z.string().trim().max(300).optional().default(''),
    imageUrl: z.union([
      z.string().trim().url().max(2000).refine(isHttpsUrl),
      z.string().regex(uploadedImagePath),
    ]),
    active: z.boolean().optional().default(true),
  });

  router.get('/blog', requirePermission('content:manage'), async (request, response, next) => {
    try {
      const result = await db.query('SELECT * FROM blog_posts ORDER BY published_at DESC, created_at DESC');
      return response.json({ posts: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/blog', requirePermission('content:manage'), async (request, response, next) => {
    const parsed = blogSchema.safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Revise os dados do artigo.', parsed);
    const { title, slug, excerpt, content, imageUrl, publishedAt, active } = parsed.data;
    try {
      const result = await db.query(
        `INSERT INTO blog_posts (title, slug, excerpt, content, image_url, published_at, active)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW()), $7)
         RETURNING *`,
        [title, slug, excerpt, content, imageUrl || null, publishedAt || null, active],
      );
      return response.status(201).json({ post: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: 'Ja existe um artigo com este endereco amigavel.' });
      return next(error);
    }
  });

  router.put('/blog/:id', requirePermission('content:manage'), async (request, response, next) => {
    if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = blogSchema.safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Revise os dados do artigo.', parsed);
    const { title, slug, excerpt, content, imageUrl, publishedAt, active } = parsed.data;
    try {
      const result = await db.query(
        `UPDATE blog_posts
         SET title = $1, slug = $2, excerpt = $3, content = $4, image_url = $5,
             published_at = COALESCE($6::timestamptz, NOW()), active = $7, updated_at = NOW()
         WHERE id = $8 RETURNING *`,
        [title, slug, excerpt, content, imageUrl || null, publishedAt || null, active, request.params.id],
      );
      if (result.rowCount === 0) return response.status(404).json({ error: 'Artigo nao encontrado.' });
      return response.json({ post: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: 'Ja existe um artigo com este endereco amigavel.' });
      return next(error);
    }
  });

  router.patch('/blog/:id/active', requirePermission('content:manage'), async (request, response, next) => {
    if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Estado do artigo invalido.', parsed);
    try {
      const result = await db.query('UPDATE blog_posts SET active = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [parsed.data.active, request.params.id]);
      if (result.rowCount === 0) return response.status(404).json({ error: 'Artigo nao encontrado.' });
      return response.json({ post: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/instructors', requirePermission('instructors:manage'), async (request, response, next) => {
    try {
      const result = await db.query('SELECT * FROM instructors ORDER BY active DESC, name');
      return response.json({ instructors: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/testimonials', requirePermission('content:manage'), async (request, response, next) => {
    try {
      const result = await db.query('SELECT * FROM testimonials ORDER BY created_at DESC');
      return response.json({ testimonials: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/testimonials', requirePermission('content:manage'), async (request, response, next) => {
    const parsed = testimonialSchema.safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Revise os dados do depoimento.', parsed);
    const { name, role, quote, avatarUrl, active } = parsed.data;
    try {
      const result = await db.query(
        'INSERT INTO testimonials (name, role, quote, avatar_url, active) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [name, role, quote, avatarUrl || null, active],
      );
      return response.status(201).json({ testimonial: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/testimonials/:id', requirePermission('content:manage'), async (request, response, next) => {
    if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = testimonialSchema.safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Revise os dados do depoimento.', parsed);
    const { name, role, quote, avatarUrl, active } = parsed.data;
    try {
      const result = await db.query(
        'UPDATE testimonials SET name = $1, role = $2, quote = $3, avatar_url = $4, active = $5, updated_at = NOW() WHERE id = $6 RETURNING *',
        [name, role, quote, avatarUrl || null, active, request.params.id],
      );
      if (result.rowCount === 0) return response.status(404).json({ error: 'Depoimento nao encontrado.' });
      return response.json({ testimonial: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/testimonials/:id/active', requirePermission('content:manage'), async (request, response, next) => {
    if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Estado do depoimento invalido.', parsed);
    try {
      const result = await db.query('UPDATE testimonials SET active = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [parsed.data.active, request.params.id]);
      if (result.rowCount === 0) return response.status(404).json({ error: 'Depoimento nao encontrado.' });
      return response.json({ testimonial: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/faqs', requirePermission('content:manage'), async (request, response, next) => {
    try {
      const result = await db.query('SELECT * FROM faqs ORDER BY created_at ASC');
      return response.json({ faqs: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/faqs', requirePermission('content:manage'), async (request, response, next) => {
    const parsed = faqSchema.safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Revise os dados da pergunta frequente.', parsed);
    const { question, answer, active } = parsed.data;
    try {
      const result = await db.query('INSERT INTO faqs (question, answer, active) VALUES ($1, $2, $3) RETURNING *', [question, answer, active]);
      return response.status(201).json({ faq: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/faqs/:id', requirePermission('content:manage'), async (request, response, next) => {
    if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = faqSchema.safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Revise os dados da pergunta frequente.', parsed);
    const { question, answer, active } = parsed.data;
    try {
      const result = await db.query('UPDATE faqs SET question = $1, answer = $2, active = $3, updated_at = NOW() WHERE id = $4 RETURNING *', [question, answer, active, request.params.id]);
      if (result.rowCount === 0) return response.status(404).json({ error: 'Pergunta nao encontrada.' });
      return response.json({ faq: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/faqs/:id/active', requirePermission('content:manage'), async (request, response, next) => {
    if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Estado da pergunta invalido.', parsed);
    try {
      const result = await db.query('UPDATE faqs SET active = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [parsed.data.active, request.params.id]);
      if (result.rowCount === 0) return response.status(404).json({ error: 'Pergunta nao encontrada.' });
      return response.json({ faq: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/gallery', requirePermission('content:manage'), async (request, response, next) => {
    try {
      const result = await db.query('SELECT * FROM gallery_items ORDER BY gallery_name, created_at DESC');
      return response.json({ gallery: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/gallery', requirePermission('content:manage'), async (request, response, next) => {
    const parsed = gallerySchema.safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Revise os dados da imagem.', parsed);
    const { galleryName, title, description, imageUrl, active } = parsed.data;
    try {
      const result = await db.query(
        `INSERT INTO gallery_items (gallery_name, title, description, image_url, active)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [galleryName, title, description, imageUrl, active],
      );
      return response.status(201).json({ item: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/gallery/:id', requirePermission('content:manage'), async (request, response, next) => {
    if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = gallerySchema.safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Revise os dados da imagem.', parsed);
    const { galleryName, title, description, imageUrl, active } = parsed.data;
    try {
      const result = await db.query(
        `UPDATE gallery_items
         SET gallery_name = $1, title = $2, description = $3, image_url = $4, active = $5, updated_at = NOW()
         WHERE id = $6 RETURNING *`,
        [galleryName, title, description, imageUrl, active, request.params.id],
      );
      if (result.rowCount === 0) return response.status(404).json({ error: 'Imagem nao encontrada.' });
      return response.json({ item: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/gallery/:id/active', requirePermission('content:manage'), async (request, response, next) => {
    if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Estado da imagem invalido.', parsed);
    try {
      const result = await db.query('UPDATE gallery_items SET active = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [parsed.data.active, request.params.id]);
      if (result.rowCount === 0) return response.status(404).json({ error: 'Imagem nao encontrada.' });
      return response.json({ item: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/instructors', requirePermission('instructors:manage'), async (request, response, next) => {
    const parsed = instructorSchema.safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Revise os dados do instrutor.', parsed);
    const instructor = parsed.data;
    try {
      const result = await db.query(
        `INSERT INTO instructors
          (name, slug, biography, qualifications, specialties, photo_url, instagram_url, website_url, email, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, name, slug, active`,
        [instructor.name, instructor.slug, instructor.biography, instructor.qualifications, instructor.specialties,
          instructor.photoUrl, instructor.instagramUrl, instructor.websiteUrl, instructor.email, instructor.active],
      );
      return response.status(201).json({ instructor: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: 'Este endereco amigavel ja esta em uso.' });
      return next(error);
    }
  });

  router.put('/instructors/:id', requirePermission('instructors:manage'), async (request, response, next) => {
    if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = instructorSchema.safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Revise os dados do instrutor.', parsed);
    const instructor = parsed.data;
    try {
      const result = await db.query(
        `UPDATE instructors SET name = $1, slug = $2, biography = $3, qualifications = $4,
           specialties = $5, photo_url = $6, instagram_url = $7, website_url = $8, email = $9,
           active = $10, updated_at = NOW()
         WHERE id = $11 RETURNING id, name, slug, active`,
        [instructor.name, instructor.slug, instructor.biography, instructor.qualifications, instructor.specialties,
          instructor.photoUrl, instructor.instagramUrl, instructor.websiteUrl, instructor.email, instructor.active, request.params.id],
      );
      if (result.rowCount === 0) return response.status(404).json({ error: 'Instrutor nao encontrado.' });
      return response.json({ instructor: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: 'Este endereco amigavel ja esta em uso.' });
      return next(error);
    }
  });

  router.patch('/instructors/:id/active', requirePermission('instructors:manage'), async (request, response, next) => {
    if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Estado do instrutor invalido.', parsed);
    try {
      const result = await db.query(
        'UPDATE instructors SET active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, active',
        [parsed.data.active, request.params.id],
      );
      if (result.rowCount === 0) return response.status(404).json({ error: 'Instrutor nao encontrado.' });
      return response.json({ instructor: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/users', requirePermission('users:manage'), async (request, response, next) => {
    try {
      const result = await db.query(`
        SELECT u.id, u.name, u.email, u.active, u.last_login_at, u.created_at,
               COALESCE(array_agg(r.code) FILTER (WHERE r.code IS NOT NULL), ARRAY[]::varchar[]) AS roles
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        GROUP BY u.id
        ORDER BY u.name
      `);
      return response.json({ users: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/users', requirePermission('users:manage'), async (request, response, next) => {
    const parsed = userSchema.safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Revise os dados do usuario.', parsed);
    const { name, email, password, role } = parsed.data;
    let client;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      const created = await client.query(
        'INSERT INTO users (name, email, password_hash) VALUES ($1, LOWER($2), $3) RETURNING id, name, email, active',
        [name, email, await bcrypt.hash(password, 12)],
      );
      const assigned = await client.query(
        'INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2 RETURNING role_id',
        [created.rows[0].id, role],
      );
      if (assigned.rowCount === 0) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: 'Perfil administrativo desconhecido.' });
      }
      await client.query('COMMIT');
      return response.status(201).json({ user: { ...created.rows[0], roles: [role] } });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      if (error.code === '23505') return response.status(409).json({ error: 'Ja existe um usuario com este e-mail.' });
      return next(error);
    } finally {
      client?.release();
    }
  });

  router.patch('/users/:id', requirePermission('users:manage'), async (request, response, next) => {
    if (!idSchema.safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = userUpdateSchema.safeParse(request.body);
    if (!parsed.success) return respondInvalid(response, 'Informe alteracoes validas para o usuario.', parsed);
    if (request.params.id === request.user.id && parsed.data.active === false) {
      return response.status(409).json({ error: 'Nao e possivel desativar sua propria conta.' });
    }

    let client;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
      const current = await client.query(`
        SELECT u.id, u.active, r.code AS role
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        WHERE u.id = $1 FOR UPDATE OF u
      `, [request.params.id]);
      if (current.rowCount === 0) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: 'Usuario nao encontrado.' });
      }

      const user = current.rows[0];
      const losesAdmin = user.role === 'admin' && (parsed.data.active === false || (parsed.data.role && parsed.data.role !== 'admin'));
      if (user.active && losesAdmin) {
        const admins = await client.query(`
          SELECT COUNT(DISTINCT u.id)::int AS count
          FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
          WHERE u.active = TRUE AND r.code = 'admin'
        `);
        if (admins.rows[0].count <= 1) {
          await client.query('ROLLBACK');
          return response.status(409).json({ error: 'Mantenha ao menos um administrador ativo.' });
        }
      }

      if (parsed.data.active !== undefined) {
        await client.query('UPDATE users SET active = $1, updated_at = NOW() WHERE id = $2', [parsed.data.active, request.params.id]);
      }
      if (parsed.data.role) {
        const role = await client.query('SELECT id FROM roles WHERE code = $1', [parsed.data.role]);
        if (role.rowCount === 0) {
          await client.query('ROLLBACK');
          return response.status(400).json({ error: 'Perfil administrativo desconhecido.' });
        }
        await client.query('DELETE FROM user_roles WHERE user_id = $1', [request.params.id]);
        await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)', [request.params.id, role.rows[0].id]);
      }
      await client.query('COMMIT');
      return response.json({ user: { id: request.params.id, ...parsed.data } });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      return next(error);
    } finally {
      client?.release();
    }
  });

  return router;
}

module.exports = createAdminManagementRouter;