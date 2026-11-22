/**
 * Registration only exists with mail sending (mailReady: mail server and
 * APP_BASE_URL). For tests that register: a registered mail server
 * whose transport sends nothing; `gesendet` collects the mails.
 * The mailer only builds the transport when sending, which is why this also applies
 * after buildAndRequire — just not in a separate server process.
 */
const path = require('node:path');

const SCHLUESSEL = ['smtp_host', 'smtp_user'];

function mailFake() {
  const nodemailer = require(path.join(__dirname, '..', '..', 'node_modules', 'nodemailer'));
  const gesendet = [];
  nodemailer.createTransport = () => ({
    sendMail: async m => {
      gesendet.push(m);
      return { messageId: 'attrappe' };
    },
  });
  return gesendet;
}

/** Registers the mail server; returns the cleanup back to the state before. */
async function enterMailServer(db) {
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  for (const [k, v] of [
    ['smtp_host', '192.0.2.25' /* one address: a name would have to resolve */],
    ['smtp_user', 'versand'],
  ])
    await db.run(
      'INSERT INTO global_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [k, v],
    );
  return async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
  };
}

module.exports = { mailFake, enterMailServer };
