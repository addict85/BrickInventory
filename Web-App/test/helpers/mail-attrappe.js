/**
 * Registrierung gibt es nur mit Mailversand (mailBereit: Mailserver und
 * APP_BASE_URL). Für Tests, die registrieren: ein eingetragener Mailserver,
 * dessen Transport nichts verschickt; die Mails sammelt `gesendet`.
 * Der Mailer baut den Transport erst beim Versand, deshalb greift das auch
 * nach buildAndRequire — nur nicht in einem eigenen Serverprozess.
 */
const path = require('node:path');

const SCHLUESSEL = ['smtp_host', 'smtp_user'];

function mailAttrappe() {
  const nodemailer = require(path.join(__dirname, '..', '..', 'node_modules', 'nodemailer'));
  const gesendet = [];
  nodemailer.createTransport = () => ({ sendMail: async (m) => { gesendet.push(m); return { messageId: 'attrappe' }; } });
  return gesendet;
}

/** Trägt den Mailserver ein; zurück kommt das Aufräumen auf den Stand davor. */
async function mailserverEintragen(db) {
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  for (const [k, v] of [['smtp_host', 'smtp.attrappe.example'], ['smtp_user', 'versand']])
    await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [k, v]);
  return async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
  };
}

module.exports = { mailAttrappe, mailserverEintragen };
