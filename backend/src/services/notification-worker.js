const MAX_ATTEMPTS = 8;
const MAX_RETRY_MINUTES = 6 * 60;

function createNotificationWorker({ db, getMailer, transporter, fromEmail, logger = console }) {
  let timer;
  let running = false;

  async function claimBatch() {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const claimed = await client.query(`
        WITH due AS (
          SELECT id
          FROM notification_outbox
          WHERE (status = 'pending' AND next_attempt_at <= NOW())
             OR (status = 'processing' AND claimed_at < NOW() - INTERVAL '5 minutes')
          ORDER BY next_attempt_at, created_at
          LIMIT 10
          FOR UPDATE SKIP LOCKED
        )
        UPDATE notification_outbox AS notification
        SET status = 'processing', claimed_at = NOW()
        FROM due
        WHERE notification.id = due.id
        RETURNING notification.id, notification.recipient_type, notification.recipient_email,
                  notification.subject, notification.body, notification.attempts
      `);
      await client.query('COMMIT');
      return claimed.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function resolveRecipient(notification) {
    if (notification.recipient_email) return notification.recipient_email;
    const result = await db.query(
      `SELECT key, value FROM site_settings
       WHERE key IN ('notification_admin_email', 'contact_email')`,
    );
    const settings = Object.fromEntries(result.rows.map(({ key, value }) => [key, value]));
    const email = settings.notification_admin_email || settings.contact_email;
    if (!email) {
      const error = new Error('Configure o e-mail de notificações administrativas nas configurações do site.');
      error.code = 'NOTIFICATION_RECIPIENT_MISSING';
      throw error;
    }
    return email;
  }

  async function markSent(id) {
    await db.query(
      `UPDATE notification_outbox
       SET status = 'sent', sent_at = NOW(), claimed_at = NULL, last_error = NULL,
           recipient_email = NULL, subject = '', body = ''
       WHERE id = $1`,
      [id],
    );
  }

  async function markFailed(notification, error) {
    if (error.code === 'NOTIFICATION_RECIPIENT_MISSING') {
      await db.query(
        `UPDATE notification_outbox
         SET status = 'pending', next_attempt_at = NOW() + INTERVAL '30 minutes',
             claimed_at = NULL, last_error = $2
         WHERE id = $1`,
        [notification.id, error.message],
      );
      logger.error(`Falha ao enviar notificacao ${notification.id}: ${error.message}`);
      return;
    }
    const attempts = notification.attempts + 1;
    const retryMinutes = Math.min(2 ** attempts, MAX_RETRY_MINUTES);
    const message = String(error.message || 'Falha no envio de e-mail.')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      .slice(0, 500);
    await db.query(
      `UPDATE notification_outbox
       SET status = $2, attempts = $3, next_attempt_at = NOW() + ($4 * INTERVAL '1 minute'),
           claimed_at = NULL, last_error = $5
       WHERE id = $1`,
      [notification.id, attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, retryMinutes, message],
    );
    logger.error(`Falha ao enviar notificacao ${notification.id}: ${message}`);
  }

  async function processPending() {
    if (running) return;
    running = true;
    try {
      const mailer = getMailer
        ? await getMailer()
        : { fromEmail, sendMail: (message) => transporter.sendMail(message) };
      if (!mailer) return;
      const notifications = await claimBatch();
      for (const notification of notifications) {
        try {
          const to = await resolveRecipient(notification);
          await mailer.sendMail({
            from: mailer.fromEmail,
            to,
            subject: notification.subject,
            text: notification.body,
          });
          await markSent(notification.id);
        } catch (error) {
          await markFailed(notification, error);
        }
      }
    } finally {
      running = false;
    }
  }

  function start(intervalMs = 30_000) {
    if (timer) return;
    timer = setInterval(() => {
      processPending().catch((error) => logger.error(`Falha ao processar fila de notificacoes: ${error.message}`));
    }, intervalMs);
    timer.unref();
    processPending().catch((error) => logger.error(`Falha ao processar fila de notificacoes: ${error.message}`));
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  return { processPending, start, stop };
}

module.exports = { createNotificationWorker };
