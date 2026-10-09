require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });

const path = require('node:path');
const nodemailer = require('nodemailer');
const pool = require('./database/pool');
const { createApp } = require('./app');
const { createNotificationWorker } = require('./services/notification-worker');
const { decryptSmtpPassword } = require('./services/smtp-secrets');

const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET,
  setupToken: process.env.ADMIN_SETUP_TOKEN,
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim()),
  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.resolve(__dirname, '../uploads'),
};

if (!config.jwtSecret || config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET precisa ter ao menos 32 caracteres. Configure o arquivo .env.');
}
if (!config.setupToken || config.setupToken.length < 24) {
  throw new Error('ADMIN_SETUP_TOKEN precisa ter ao menos 24 caracteres. Configure o arquivo .env.');
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL nao configurada. Configure o arquivo .env.');
}

const app = createApp({ db: pool, config });
const notificationWorker = createNotificationWorker({
  db: pool,
  getMailer: async () => {
    const result = await pool.query(
      `SELECT key, value FROM site_settings
       WHERE key IN ('smtp_enabled', 'smtp_host', 'smtp_port', 'smtp_secure',
         'smtp_user', 'smtp_from', 'smtp_password_encrypted')`,
    );
    const smtpSettings = Object.fromEntries(result.rows.map(({ key, value }) => [key, value]));
    if (!smtpSettings.smtp_enabled) return null;
    if (!smtpSettings.smtp_host || !smtpSettings.smtp_port || !smtpSettings.smtp_user || !smtpSettings.smtp_from
      || !smtpSettings.smtp_password_encrypted) {
      throw new Error('Configuracao SMTP incompleta; revise Configuracoes no painel administrativo.');
    }
    const transporter = nodemailer.createTransport({
      host: smtpSettings.smtp_host,
      port: Number(smtpSettings.smtp_port),
      secure: Boolean(smtpSettings.smtp_secure) || Number(smtpSettings.smtp_port) === 465,
      auth: {
        user: smtpSettings.smtp_user,
        pass: decryptSmtpPassword(smtpSettings.smtp_password_encrypted, config.jwtSecret),
      },
    });
    return {
      fromEmail: smtpSettings.smtp_from,
      sendMail: (message) => transporter.sendMail(message),
    };
  },
});
const server = app.listen(config.port, () => {
  console.log(`API disponivel em http://localhost:${config.port}`);
  notificationWorker.start();
});

async function shutdown() {
  notificationWorker.stop();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
