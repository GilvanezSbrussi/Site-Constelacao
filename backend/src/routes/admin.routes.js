const express = require('express');
const { z } = require('zod');
const { createAuthenticate, createRequirePermission } = require('../middleware/auth');

const nullableText = (max) => z.string().trim().max(max).nullable().optional();
const nullableNumber = (minimum = 0) => z.union([
  z.number().int().min(minimum),
  z.null(),
]).optional();
const uploadedImagePath = /^\/uploads\/[a-f0-9]{32}\.(?:jpg|png|webp)$/;
const isHttpsUrl = (value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const activitySchema = z.object({
  title: z.string().trim().min(3).max(180),
  slug: z.string().trim().min(3).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  shortDescription: z.string().trim().min(3).max(300),
  description: z.string().trim().min(3).max(20_000),
  imageUrl: z.union([
    z.string().url().max(2000).refine(isHttpsUrl),
    z.string().regex(uploadedImagePath),
    z.literal(''),
    z.null(),
  ]).optional().transform((value) => value || null),
  modality: z.enum(['in_person', 'online', 'hybrid']),
  workloadHours: nullableNumber(1),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  location: nullableText(180),
  availableSpots: nullableNumber(),
  priceCents: nullableNumber(),
  promotionalPriceCents: nullableNumber(),
  instructorIds: z.array(z.string().uuid()).max(20).optional().default([]),
  categoryId: z.string().uuid().nullable().optional(),
  status: z.enum(['draft', 'published', 'enrollments_open', 'enrollments_closed', 'ended', 'cancelled']),
}).superRefine((activity, context) => {
  if (activity.promotionalPriceCents != null && activity.priceCents == null) {
    context.addIssue({ code: 'custom', path: ['promotionalPriceCents'], message: 'Informe o valor original.' });
  } else if (activity.promotionalPriceCents > activity.priceCents) {
    context.addIssue({ code: 'custom', path: ['promotionalPriceCents'], message: 'O valor promocional nao pode superar o valor original.' });
  }
  if (activity.startsAt && activity.endsAt && new Date(activity.endsAt) < new Date(activity.startsAt)) {
    context.addIssue({ code: 'custom', path: ['endsAt'], message: 'A data final deve ser posterior a inicial.' });
  }
});

const enrollmentStatusSchema = z.object({
  status: z.enum(['new', 'contacted', 'awaiting_payment', 'confirmed', 'cancelled', 'completed']),
});

const contactStatusSchema = z.object({
  status: z.enum(['new', 'in_progress', 'replied', 'closed']),
});

function sendValidationError(response, message, result) {
  return response.status(400).json({ error: message, details: result.error.flatten() });
}

function createAdminRouter({ db, config }) {
  const router = express.Router();
  const authenticate = createAuthenticate({ db, jwtSecret: config.jwtSecret });
  const requirePermission = createRequirePermission({ db });

  router.use(authenticate);

  router.get('/dashboard', async (request, response, next) => {
    try {
      const result = await db.query(`
        SELECT
          (SELECT COUNT(*)::int FROM courses WHERE status <> 'cancelled') AS courses,
          (SELECT COUNT(*)::int FROM events WHERE status <> 'cancelled') AS events,
          (SELECT COUNT(*)::int FROM enrollments) AS enrollments,
          (SELECT COUNT(*)::int FROM contacts WHERE status = 'new') AS new_contacts,
          (SELECT COUNT(*)::int FROM enrollments WHERE status = 'new') AS new_enrollments
      `);
      return response.json({ metrics: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/course-categories', requirePermission('courses:manage'), async (request, response, next) => {
    try {
      const result = await db.query('SELECT * FROM course_categories ORDER BY active DESC, name');
      return response.json({ categories: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/course-categories', requirePermission('courses:manage'), async (request, response, next) => {
    const parsed = z.object({
      name: z.string().trim().min(2).max(120),
      slug: z.string().trim().min(2).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      description: z.string().trim().max(500).optional().default(''),
    }).safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, 'Revise os dados da categoria.', parsed);
    try {
      const result = await db.query(
        'INSERT INTO course_categories (name, slug, description) VALUES ($1, $2, $3) RETURNING *',
        [parsed.data.name, parsed.data.slug, parsed.data.description],
      );
      return response.status(201).json({ category: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: 'Ja existe uma categoria com esse nome ou endereco.' });
      return next(error);
    }
  });

  router.put('/course-categories/:id', requirePermission('courses:manage'), async (request, response, next) => {
    if (!z.string().uuid().safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = z.object({
      name: z.string().trim().min(2).max(120),
      slug: z.string().trim().min(2).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      description: z.string().trim().max(500).optional().default(''),
    }).safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, 'Revise os dados da categoria.', parsed);
    try {
      const result = await db.query(
        `UPDATE course_categories
         SET name = $1, slug = $2, description = $3, updated_at = NOW()
         WHERE id = $4 RETURNING *`,
        [parsed.data.name, parsed.data.slug, parsed.data.description, request.params.id],
      );
      if (!result.rowCount) return response.status(404).json({ error: 'Categoria nao encontrada.' });
      return response.json({ category: result.rows[0] });
    } catch (error) {
      if (error.code === '23505') return response.status(409).json({ error: 'Ja existe uma categoria com esse nome ou endereco.' });
      return next(error);
    }
  });

  router.patch('/course-categories/:id/active', requirePermission('courses:manage'), async (request, response, next) => {
    if (!z.string().uuid().safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, 'Estado da categoria invalido.', parsed);
    try {
      const result = await db.query(
        'UPDATE course_categories SET active = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [parsed.data.active, request.params.id],
      );
      if (!result.rowCount) return response.status(404).json({ error: 'Categoria nao encontrada.' });
      return response.json({ category: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  for (const [resource, permission] of [['courses', 'courses:manage'], ['events', 'events:manage']]) {
    const table = resource;
    const itemName = resource === 'courses' ? 'course' : 'event';
    const authorize = requirePermission(permission);

    router.get(`/${resource}`, authorize, async (request, response, next) => {
      try {
        const result = table === 'courses'
          ? await db.query(`
              SELECT c.*, cc.name AS category_name,
                     COALESCE(array_agg(ci.instructor_id) FILTER (WHERE ci.instructor_id IS NOT NULL), ARRAY[]::uuid[]) AS instructor_ids
              FROM courses c
              LEFT JOIN course_categories cc ON cc.id = c.category_id
              LEFT JOIN course_instructors ci ON ci.course_id = c.id
              GROUP BY c.id, cc.name ORDER BY c.created_at DESC
            `)
          : await db.query(`SELECT * FROM ${table} ORDER BY created_at DESC`);
        return response.json({ [resource]: result.rows });
      } catch (error) {
        return next(error);
      }
    });

    router.post(`/${resource}`, authorize, async (request, response, next) => {
      const parsed = activitySchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(response, 'Revise os campos do cadastro.', parsed);

      const data = parsed.data;
      const fields = ['title', 'slug', 'short_description', 'description', 'image_url', 'modality'];
      const values = [data.title, data.slug, data.shortDescription, data.description, data.imageUrl, data.modality];
      if (table === 'courses') {
        fields.push('workload_hours');
        values.push(data.workloadHours ?? null);
        fields.push('category_id');
        values.push(data.categoryId ?? null);
      }
      fields.push('starts_at', 'ends_at', 'location', 'available_spots', 'price_cents', 'promotional_price_cents', 'status');
      values.push(data.startsAt ?? null, data.endsAt ?? null, data.location || null, data.availableSpots ?? null,
        data.priceCents ?? null, data.promotionalPriceCents ?? null, data.status);
      const placeholders = values.map((value, index) => `$${index + 1}`);

      try {
        if (table === 'courses' && data.categoryId) {
          const category = await db.query('SELECT id FROM course_categories WHERE id = $1 AND active = TRUE', [data.categoryId]);
          if (!category.rowCount) return response.status(400).json({ error: 'Selecione uma categoria ativa.' });
        }
        const result = await db.query(
          `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
          values,
        );
        return response.status(201).json({ [itemName]: result.rows[0] });
      } catch (error) {
        if (error.code === '23505') return response.status(409).json({ error: 'Este endereco amigavel ja esta em uso.' });
        return next(error);
      }
    });

    router.put(`/${resource}/:id`, authorize, async (request, response, next) => {
      if (!z.string().uuid().safeParse(request.params.id).success) {
        return response.status(400).json({ error: 'Identificador invalido.' });
      }
      const parsed = activitySchema.safeParse(request.body);
      if (!parsed.success) return sendValidationError(response, 'Revise os campos do cadastro.', parsed);

      const data = parsed.data;
      const assignments = [
        'title = $1', 'slug = $2', 'short_description = $3', 'description = $4', 'image_url = $5', 'modality = $6',
      ];
      const values = [data.title, data.slug, data.shortDescription, data.description, data.imageUrl, data.modality];
      if (table === 'courses') {
        assignments.push(`workload_hours = $${values.length + 1}`);
        values.push(data.workloadHours ?? null);
        assignments.push(`category_id = $${values.length + 1}`);
        values.push(data.categoryId ?? null);
      }
      for (const [column, value] of [
        ['starts_at', data.startsAt ?? null],
        ['ends_at', data.endsAt ?? null],
        ['location', data.location || null],
        ['available_spots', data.availableSpots ?? null],
        ['price_cents', data.priceCents ?? null],
        ['promotional_price_cents', data.promotionalPriceCents ?? null],
        ['status', data.status],
      ]) {
        assignments.push(`${column} = $${values.length + 1}`);
        values.push(value);
      }
      assignments.push('updated_at = NOW()');
      values.push(request.params.id);

      try {
        if (table === 'courses' && data.categoryId) {
          const category = await db.query(
            `SELECT id FROM course_categories WHERE id = $1 AND (
               active = TRUE OR id = (SELECT category_id FROM courses WHERE id = $2)
             )`,
            [data.categoryId, request.params.id],
          );
          if (!category.rowCount) return response.status(400).json({ error: 'Selecione uma categoria ativa.' });
        }
        const result = await db.query(
          `UPDATE ${table} SET ${assignments.join(', ')} WHERE id = $${values.length} RETURNING *`,
          values,
        );
        if (result.rowCount === 0) return response.status(404).json({ error: 'Cadastro nao encontrado.' });
        return response.json({ [itemName]: result.rows[0] });
      } catch (error) {
        if (error.code === '23505') return response.status(409).json({ error: 'Este endereco amigavel ja esta em uso.' });
        return next(error);
      }
    });

    router.delete(`/${resource}/:id`, authorize, async (request, response, next) => {
      if (!z.string().uuid().safeParse(request.params.id).success) {
        return response.status(400).json({ error: 'Identificador invalido.' });
      }
      try {
        const result = await db.query(
          `UPDATE ${table} SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING id`,
          [request.params.id],
        );
        if (result.rowCount === 0) return response.status(404).json({ error: 'Cadastro nao encontrado.' });
        return response.status(204).end();
      } catch (error) {
        return next(error);
      }
    });
  }

  const moduleSchema = z.object({
    title: z.string().trim().min(2).max(180),
    description: z.string().trim().max(4000).optional().default(''),
    position: z.number().int().min(1).max(500),
    workloadHours: nullableNumber(1),
    active: z.boolean().optional().default(true),
  });

  router.get('/courses/:id/modules', requirePermission('courses:manage'), async (request, response, next) => {
    if (!z.string().uuid().safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    try {
      const result = await db.query(
        'SELECT * FROM course_modules WHERE course_id = $1 ORDER BY position, created_at',
        [request.params.id],
      );
      return response.json({ modules: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/courses/:id/modules', requirePermission('courses:manage'), async (request, response, next) => {
    if (!z.string().uuid().safeParse(request.params.id).success) return response.status(400).json({ error: 'Identificador invalido.' });
    const parsed = moduleSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, 'Revise os dados do modulo.', parsed);
    try {
      const result = await db.query(
        `INSERT INTO course_modules (course_id, title, description, position, workload_hours, active)
         SELECT id, $2, $3, $4, $5, $6 FROM courses WHERE id = $1
         RETURNING *`,
        [request.params.id, parsed.data.title, parsed.data.description, parsed.data.position, parsed.data.workloadHours ?? null, parsed.data.active],
      );
      if (!result.rowCount) return response.status(404).json({ error: 'Curso nao encontrado.' });
      return response.status(201).json({ module: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/courses/:courseId/modules/:moduleId', requirePermission('courses:manage'), async (request, response, next) => {
    if (!z.string().uuid().safeParse(request.params.courseId).success || !z.string().uuid().safeParse(request.params.moduleId).success) {
      return response.status(400).json({ error: 'Identificador invalido.' });
    }
    const parsed = moduleSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, 'Revise os dados do modulo.', parsed);
    try {
      const result = await db.query(
        `UPDATE course_modules
         SET title = $1, description = $2, position = $3, workload_hours = $4, active = $5, updated_at = NOW()
         WHERE id = $6 AND course_id = $7 RETURNING *`,
        [parsed.data.title, parsed.data.description, parsed.data.position, parsed.data.workloadHours ?? null, parsed.data.active,
          request.params.moduleId, request.params.courseId],
      );
      if (!result.rowCount) return response.status(404).json({ error: 'Modulo nao encontrado para este curso.' });
      return response.json({ module: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/courses/:courseId/modules/:moduleId/active', requirePermission('courses:manage'), async (request, response, next) => {
    if (!z.string().uuid().safeParse(request.params.courseId).success || !z.string().uuid().safeParse(request.params.moduleId).success) {
      return response.status(400).json({ error: 'Identificador invalido.' });
    }
    const parsed = z.object({ active: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, 'Estado do modulo invalido.', parsed);
    try {
      const result = await db.query(
        `UPDATE course_modules SET active = $1, updated_at = NOW()
         WHERE id = $2 AND course_id = $3 RETURNING *`,
        [parsed.data.active, request.params.moduleId, request.params.courseId],
      );
      if (!result.rowCount) return response.status(404).json({ error: 'Modulo nao encontrado para este curso.' });
      return response.json({ module: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/courses/:id/instructors', requirePermission('courses:manage'), async (request, response, next) => {
    if (!z.string().uuid().safeParse(request.params.id).success) {
      return response.status(400).json({ error: 'Identificador invalido.' });
    }
    const parsed = z.object({ instructorIds: z.array(z.string().uuid()).max(20) }).safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, 'Selecione instrutores validos.', parsed);
    const instructorIds = [...new Set(parsed.data.instructorIds)];
    let client;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      const course = await client.query('SELECT id FROM courses WHERE id = $1 FOR UPDATE', [request.params.id]);
      if (course.rowCount === 0) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: 'Curso nao encontrado.' });
      }
      if (instructorIds.length > 0) {
        const active = await client.query(
          'SELECT id FROM instructors WHERE active = TRUE AND id = ANY($1::uuid[])',
          [instructorIds],
        );
        if (active.rowCount !== instructorIds.length) {
          await client.query('ROLLBACK');
          return response.status(400).json({ error: 'Um ou mais instrutores estao inativos ou nao existem.' });
        }
      }
      await client.query('DELETE FROM course_instructors WHERE course_id = $1', [request.params.id]);
      if (instructorIds.length > 0) {
        await client.query(
          'INSERT INTO course_instructors (course_id, instructor_id) SELECT $1, unnest($2::uuid[])',
          [request.params.id, instructorIds],
        );
      }
      await client.query('COMMIT');
      return response.json({ instructorIds });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      return next(error);
    } finally {
      client?.release();
    }
  });

  router.get('/enrollments', requirePermission('enrollments:read'), async (request, response, next) => {
    try {
      const result = await db.query(`
        SELECT en.id, en.name, en.email, en.phone, en.city, en.state, en.observations, en.status, en.created_at,
               COALESCE(c.title, ev.title) AS activity_title,
               CASE WHEN en.course_id IS NOT NULL THEN 'course' ELSE 'event' END AS activity_type,
               ep.status AS payment_status, ep.amount_cents AS payment_amount_cents, ep.checkout_url
        FROM enrollments en
        LEFT JOIN courses c ON c.id = en.course_id
        LEFT JOIN events ev ON ev.id = en.event_id
        LEFT JOIN enrollment_payments ep ON ep.enrollment_id = en.id
        ORDER BY en.created_at DESC
      `);
      return response.json({ enrollments: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/enrollments/:id/status', requirePermission('enrollments:manage'), async (request, response, next) => {
    if (!z.string().uuid().safeParse(request.params.id).success) {
      return response.status(400).json({ error: 'Identificador invalido.' });
    }
    const parsed = enrollmentStatusSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, 'Status de inscricao invalido.', parsed);

    let client;
    try {
      client = await db.connect();
      await client.query('BEGIN');
      const current = await client.query('SELECT course_id, event_id, status FROM enrollments WHERE id = $1 FOR UPDATE', [request.params.id]);
      if (current.rowCount === 0) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: 'Inscricao nao encontrada.' });
      }

      const row = current.rows[0];
      const targetTable = row.course_id ? 'courses' : 'events';
      const targetId = row.course_id || row.event_id;
      if (row.status !== 'cancelled' && parsed.data.status === 'cancelled') {
        await client.query(
          `UPDATE ${targetTable} SET enrolled_count = GREATEST(enrolled_count - 1, 0), updated_at = NOW() WHERE id = $1`,
          [targetId],
        );
      } else if (row.status === 'cancelled' && parsed.data.status !== 'cancelled') {
        const reopened = await client.query(
          `UPDATE ${targetTable}
           SET enrolled_count = enrolled_count + 1, updated_at = NOW()
           WHERE id = $1 AND status = 'enrollments_open'
             AND (available_spots IS NULL OR enrolled_count < available_spots)
           RETURNING id`,
          [targetId],
        );
        if (reopened.rowCount === 0) {
          await client.query('ROLLBACK');
          return response.status(409).json({ error: 'Nao ha vaga para reativar esta inscricao.' });
        }
      }

      const result = await client.query(
        'UPDATE enrollments SET status = $1 WHERE id = $2 RETURNING id, status',
        [parsed.data.status, request.params.id],
      );
      await client.query('COMMIT');
      return response.json({ enrollment: result.rows[0] });
    } catch (error) {
      if (client) await client.query('ROLLBACK');
      return next(error);
    } finally {
      client?.release();
    }
  });

  router.get('/contacts', requirePermission('contacts:manage'), async (request, response, next) => {
    try {
      const result = await db.query('SELECT id, name, email, phone, subject, message, status, created_at FROM contacts ORDER BY created_at DESC');
      return response.json({ contacts: result.rows });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/contacts/:id/status', requirePermission('contacts:manage'), async (request, response, next) => {
    if (!z.string().uuid().safeParse(request.params.id).success) {
      return response.status(400).json({ error: 'Identificador invalido.' });
    }
    const parsed = contactStatusSchema.safeParse(request.body);
    if (!parsed.success) return sendValidationError(response, 'Status de contato invalido.', parsed);
    try {
      const result = await db.query(
        'UPDATE contacts SET status = $1 WHERE id = $2 RETURNING id, status',
        [parsed.data.status, request.params.id],
      );
      if (result.rowCount === 0) return response.status(404).json({ error: 'Contato nao encontrado.' });
      return response.json({ contact: result.rows[0] });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = createAdminRouter;