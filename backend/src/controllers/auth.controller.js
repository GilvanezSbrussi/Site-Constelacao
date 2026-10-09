const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const { z } = require('zod');

const setupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

function createToken(userId, jwtSecret) {
  return jwt.sign({}, jwtSecret, { subject: userId, expiresIn: '8h', algorithm: 'HS256' });
}

function safeTokenEqual(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createAuthController({ db, jwtSecret, setupToken }) {
  return {
    async setup(request, response) {
      if (!safeTokenEqual(request.get('x-setup-token'), setupToken)) {
        return response.status(403).json({ error: 'Token de configuracao invalido.' });
      }

      const parsed = setupSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: 'Dados invalidos.', details: parsed.error.flatten() });
      }

      const { name, email, password } = parsed.data;
      const passwordHash = await bcrypt.hash(password, 12);
      const client = await db.connect();
      try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
        const existingUsers = await client.query('SELECT 1 FROM users LIMIT 1');
        if (existingUsers.rowCount > 0) {
          await client.query('ROLLBACK');
          return response.status(409).json({ error: 'A configuracao inicial ja foi concluida.' });
        }

        const created = await client.query(
          'INSERT INTO users (name, email, password_hash) VALUES ($1, LOWER($2), $3) RETURNING id, name, email',
          [name, email, passwordHash],
        );
        await client.query(
          "INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = 'admin'",
          [created.rows[0].id],
        );
        await client.query('COMMIT');

        return response.status(201).json({ user: created.rows[0], accessToken: createToken(created.rows[0].id, jwtSecret) });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async login(request, response) {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return response.status(400).json({ error: 'E-mail ou senha invalidos.' });
      }

      const { email, password } = parsed.data;
      const result = await db.query(
        'SELECT id, name, email, password_hash FROM users WHERE LOWER(email) = LOWER($1) AND active = TRUE',
        [email],
      );
      const user = result.rows[0];
      const passwordMatches = user && await bcrypt.compare(password, user.password_hash);
      if (!passwordMatches) {
        return response.status(401).json({ error: 'E-mail ou senha invalidos.' });
      }

      await db.query('UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1', [user.id]);
      return response.json({
        user: { id: user.id, name: user.name, email: user.email },
        accessToken: createToken(user.id, jwtSecret),
      });
    },

    me(request, response) {
      return response.json({ user: request.user });
    },
  };
}

module.exports = { createAuthController };
