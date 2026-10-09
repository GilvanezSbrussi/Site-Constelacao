const crypto = require('node:crypto');

function encryptionKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('A chave JWT precisa ter ao menos 32 caracteres para proteger a senha SMTP.');
  }
  return crypto.createHmac('sha256', secret).update('constelacao-smtp-settings-v1').digest();
}

function encryptSmtpPassword(password, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), ciphertext.toString('hex')].join(':');
}

function decryptSmtpPassword(encrypted, secret) {
  const [version, ivHex, tagHex, ciphertextHex, ...extra] = String(encrypted || '').split(':');
  if (version !== 'v1' || !ivHex || !tagHex || !ciphertextHex || extra.length) {
    throw new Error('A senha SMTP armazenada possui formato invalido. Salve-a novamente nas configuracoes.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { decryptSmtpPassword, encryptSmtpPassword };
