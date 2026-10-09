const jwt = require('jsonwebtoken');

function createAuthenticate({ db, jwtSecret }) {
  return async function authenticate(request, response, next) {
    const authorization = request.get('authorization') || '';
    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return response.status(401).json({ error: 'Autenticacao necessaria.' });
    }

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    } catch {
      return response.status(401).json({ error: 'Token invalido ou expirado.' });
    }

    const result = await db.query(
      'SELECT id, name, email FROM users WHERE id = $1 AND active = TRUE',
      [payload.sub],
    );
    if (result.rowCount === 0) {
      return response.status(401).json({ error: 'Sessao invalida ou usuario inativo.' });
    }
    request.user = result.rows[0];
    return next();
  };
}

function createRequirePermission({ db }) {
  return function requirePermission(permissionCode) {
    return async function authorize(request, response, next) {
      try {
        const result = await db.query(
          `SELECT 1
           FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id
           WHERE ur.user_id = $1 AND p.code = $2
           LIMIT 1`,
          [request.user.id, permissionCode],
        );
        if (result.rowCount === 0) {
          return response.status(403).json({ error: 'Voce nao tem permissao para esta acao.' });
        }
        return next();
      } catch (error) {
        return next(error);
      }
    };
  };
}

module.exports = { createAuthenticate, createRequirePermission };
