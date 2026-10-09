const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationWorker } = require('../src/services/notification-worker');

function makeDatabase(notification) {
  const updates = [];
  const client = {
    async query(sql) {
      if (sql.includes('RETURNING notification.id')) return { rows: [notification], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const db = {
    async connect() {
      return client;
    },
    async query(sql, values) {
      updates.push({ sql, values });
      return { rows: [], rowCount: 1 };
    },
  };
  return { db, updates };
}

test('notification worker envia e marca a mensagem como enviada', async () => {
  const notification = {
    id: 1,
    recipient_type: 'customer',
    recipient_email: 'participante@example.com',
    subject: 'Inscricao recebida',
    body: 'Recebemos sua inscricao.',
    attempts: 0,
  };
  const { db, updates } = makeDatabase(notification);
  const messages = [];
  const worker = createNotificationWorker({
    db,
    transporter: { async sendMail(message) { messages.push(message); } },
    fromEmail: 'site@example.com',
  });

  await worker.processPending();

  assert.deepEqual(messages, [{
    from: 'site@example.com',
    to: 'participante@example.com',
    subject: 'Inscricao recebida',
    text: 'Recebemos sua inscricao.',
  }]);
  assert.match(updates[0].sql, /SET status = 'sent'/);
  assert.deepEqual(updates[0].values, [1]);
});

test('notification worker registra falha e agenda nova tentativa sem perder a mensagem', async () => {
  const notification = {
    id: 2,
    recipient_type: 'admin',
    recipient_email: 'equipe@example.com',
    subject: 'Nova inscricao',
    body: 'Nova inscricao recebida.',
    attempts: 0,
  };
  const { db, updates } = makeDatabase(notification);
  const errors = [];
  const worker = createNotificationWorker({
    db,
    transporter: { async sendMail() { throw new Error('SMTP indisponivel'); } },
    fromEmail: 'site@example.com',
    logger: { error(message) { errors.push(message); } },
  });

  await worker.processPending();

  assert.match(updates[0].sql, /SET status = \$2, attempts = \$3/);
  assert.deepEqual(updates[0].values.slice(0, 4), [2, 'pending', 1, 2]);
  assert.match(errors[0], /SMTP indisponivel/);
});

test('notification worker aguarda a configuracao do e-mail administrativo sem descartar a mensagem', async () => {
  const notification = {
    id: 3,
    recipient_type: 'admin',
    recipient_email: null,
    subject: 'Nova inscricao',
    body: 'Nova inscricao recebida.',
    attempts: 0,
  };
  const { db, updates } = makeDatabase(notification);
  db.query = async (sql, values) => {
    updates.push({ sql, values });
    if (sql.includes('FROM site_settings')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  };
  const errors = [];
  const worker = createNotificationWorker({
    db,
    transporter: { async sendMail() { assert.fail('A mensagem nao pode ser enviada sem destinatario.'); } },
    fromEmail: 'site@example.com',
    logger: { error(message) { errors.push(message); } },
  });

  await worker.processPending();

  assert.match(updates[1].sql, /next_attempt_at = NOW\(\) \+ INTERVAL '30 minutes'/);
  assert.deepEqual(updates[1].values, [3, 'Configure o e-mail de notificações administrativas nas configurações do site.']);
  assert.match(errors[0], /Configure o e-mail de notificações administrativas/);
});

test('notification worker nao reivindica mensagens quando o SMTP estiver desativado', async () => {
  let claimed = false;
  const worker = createNotificationWorker({
    db: {
      async connect() {
        claimed = true;
        throw new Error('A fila nao deve ser reivindicada sem SMTP.');
      },
    },
    getMailer: async () => null,
  });

  await worker.processPending();

  assert.equal(claimed, false);
});
