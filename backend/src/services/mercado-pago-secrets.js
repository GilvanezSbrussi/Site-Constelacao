const crypto = require('node:crypto');

function keyFor(secret, purpose) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('JWT_SECRET precisa ter ao menos 32 caracteres para proteger as credenciais de pagamento.');
  }
  return crypto.createHmac('sha256', secret).update(`constelacao-mercado-pago-${purpose}-v1`).digest();
}

function encryptPaymentSecret(value, secret, purpose) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(secret, purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), ciphertext.toString('hex')].join(':');
}

function decryptPaymentSecret(encrypted, secret, purpose) {
  const [version, ivHex, tagHex, ciphertextHex, ...extra] = String(encrypted || '').split(':');
  if (version !== 'v1' || !ivHex || !tagHex || !ciphertextHex || extra.length) {
    throw new Error('A credencial do Mercado Pago armazenada possui formato invalido. Salve-a novamente nas configuracoes.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(secret, purpose), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { decryptPaymentSecret, encryptPaymentSecret };
