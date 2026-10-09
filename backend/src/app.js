const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('node:path');
const createAuthRouter = require('./routes/auth.routes');
const createPublicRouter = require('./routes/public.routes');
const createAdminRouter = require('./routes/admin.routes');
const createAdminManagementRouter = require('./routes/admin-management.routes');

function createApp({ db, config }) {
  const app = express();
  const allowedOrigins = config.corsOrigins;
  const isAllowedOrigin = (origin, host) => {
    if (allowedOrigins.includes(origin)) return true;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  };

  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', 'https:'],
      },
    },
  }));
  app.use((request, response, next) => {
    const origin = request.get('origin');
    if (origin && !isAllowedOrigin(origin, request.get('host'))) {
      return response.status(403).json({ error: 'Origem nao autorizada.' });
    }
    if (origin) {
      response.set('Access-Control-Allow-Origin', origin);
      response.vary('Origin');
    }
    return next();
  });
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/v1/health', (request, response) => response.json({ status: 'ok', service: 'api' }));
  app.use('/api/v1/auth', createAuthRouter({ db, config }));
  app.use('/api/v1', createPublicRouter({ db, config }));
  app.use('/api/v1/admin', createAdminRouter({ db, config }));
  app.use('/api/v1/admin', createAdminManagementRouter({ db, config }));
  app.use('/uploads', express.static(config.uploadDir || path.resolve(__dirname, '../../uploads'), {
    dotfiles: 'deny',
    index: false,
    immutable: true,
    maxAge: '1y',
  }));
  app.use('/fonts', express.static(path.resolve(__dirname, '../../node_modules/@fontsource-variable/manrope/files')));
  app.use(express.static(path.resolve(__dirname, '../../frontend')));
  app.use((request, response) => response.status(404).json({ error: 'Rota nao encontrada.' }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    console.error(`Erro na API: ${error.message}`);
    return response.status(500).json({ error: 'Erro interno. Tente novamente mais tarde.' });
  });

  return app;
}

module.exports = { createApp };
