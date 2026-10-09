const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createAuthenticate } = require('../middleware/auth');
const { createAuthController } = require('../controllers/auth.controller');

function createAuthRouter({ db, config }) {
  const router = express.Router();
  const authenticate = createAuthenticate({ db, jwtSecret: config.jwtSecret });
  const controller = createAuthController({
    db,
    jwtSecret: config.jwtSecret,
    setupToken: config.setupToken,
  });

  router.post('/setup', rateLimit({ windowMs: 60 * 60 * 1000, limit: 5 }), controller.setup);
  router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), controller.login);
  router.get('/me', authenticate, controller.me);

  return router;
}

module.exports = createAuthRouter;
