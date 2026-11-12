/**
 * Jede Mail geht in der Sprache ihres EMPFÄNGERS hinaus — und sieht aus wie
 * die anderen.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) `lang` aus sendPasswordResetMail() entfernt        → Schritt 1 rot.
 *   b) Den englischen Zweig daraus entfernt               → Schritt 2 rot.
 *   c) Das Argument am Aufruf des E-Mail-Wechsels weg     → Schritt 3 rot.
 *   d) emailTemplate aus der Alarmmail entfernt           → Schritt 4 rot.
 * Gegenproben (08.11.2026 gemessen, Schritte 3 und 4 jetzt ausgeführt):
 *   e) in /forgot-password `String(lang ?? 'de')` → `'de'` → Schritt 3 rot
 *      (die Mail an das englische Konto ist deutsch); ebenso in
 *      /bestaetigung-erneut
 *   f) baueAlarmMail ohne emailTemplate (html = text) → Schritt 4 rot
 */
const test = require('node:test');
const { umgebung } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');

const lies = rel => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const MAILER = lies('src/mail/mailer.ts');

/** Der Rumpf einer Funktion — ab ihrem Kopf bis zur nächsten auf Spaltenanfang. */
function rumpf(quelle, kopf) {
  const i = quelle.indexOf(kopf);
  assert.ok(i >= 0, `${kopf} nicht gefunden — umbenannt?`);
  const rest = quelle.slice(i + kopf.length);
  const m = rest.search(/\n(?:export )?(?:async )?function |\nexport \{/);
  return m >= 0 ? rest.slice(0, m) : rest;
}

test('1. jede Mail-Funktion nimmt die Sprache entgegen', () => {
  // Gefunden wird über den NAMEN, nicht über eine Liste: Eine vierte Mail
  // soll von dieser Regel erfasst werden, ohne dass jemand sie hier einträgt.
  const namen = [...MAILER.matchAll(/async function (send\w*Mail|baue\w*Mail)\s*\(/g)]
    .map(m => m[1])
    .filter(n => n !== 'sendMail'); // der Versand selbst formuliert nichts
  assert.ok(namen.length >= 3, `Nur ${namen.length} Mail-Funktionen gefunden (gemessen waren es 3) — umbenannt?`);

  for (const n of namen) {
    const kopf = MAILER.slice(MAILER.indexOf(`async function ${n}(`));
    const liste = kopf.slice(0, kopf.indexOf(')') + 1);
    // Zwei zulässige Formen, und beide kommen vor: `lang = 'de'` direkt in der
    // Liste (die beiden send*-Funktionen) oder ein benannter Typ, der das Feld
    // trägt (baueAlarmMail nimmt ein Datenobjekt, weil es neun Werte sind).
    // Nur auf die Zeichenkette „lang" in der Liste zu prüfen, hätte die zweite
    // Form fälschlich gemeldet — was sie beim ersten Lauf auch tat.
    const typ = (liste.match(/:\s*(\w+)\s*,?\s*\)/) || [])[1];
    const traegtLang =
      /lang/.test(liste) ||
      (typ &&
        /lang\s*:/.test(
          MAILER.slice(MAILER.indexOf(`interface ${typ} {`)).slice(
            0,
            MAILER.slice(MAILER.indexOf(`interface ${typ} {`)).indexOf('}'),
          ),
        ));
    assert.ok(traegtLang, `${n}() kennt die Sprache des Empfängers nicht — sie ginge immer in der Vorgabe hinaus.`);
  }
});

test('2. und beherrscht beide Sprachen wirklich', () => {
  // Ein `lang`-Parameter, der nirgends gelesen wird, ist schlimmer als keiner:
  // Er sieht nach Mehrsprachigkeit aus.
  for (const [n, kopf] of [
    ['sendVerificationMail', 'async function sendVerificationMail('],
    ['sendPasswordResetMail', 'async function sendPasswordResetMail('],
    ['baueAlarmMail', 'async function baueAlarmMail('],
  ]) {
    const body = rumpf(MAILER, kopf);
    assert.match(body, /lang (?:!==|===) 'en'/, `${n}() verzweigt nicht nach der Sprache.`);
    // Ein englischer Satz, der nicht bloss ein Schlüsselwort ist.
    assert.ok(
      /Hello |Hi |Reset |Confirm |Price alert/.test(body),
      `${n}() hat keinen englischen Text — der Parameter wäre Dekoration.`,
    );
  }
});

test('3. und jeder Aufrufer gibt sie mit — die Mail ist in der Sprache des Kontos', { timeout: 60_000 }, async t => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  umgebung({ APP_BASE_URL: 'http://localhost' });
  const { mailAttrappe, mailserverEintragen } = require('./helpers/mail-attrappe');
  const gesendet = mailAttrappe();
  const _req = require('./helpers/sources').buildAndRequire();
  const db = await require('./helpers/db').dbOderSkip(t, _req);
  if (!db) return;
  const { bis } = require('./helpers/zeit');
  const NAME = `mailsprache_${process.pid}`;
  await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
  await db.run(
    "DELETE FROM rate_limit_attempts WHERE key LIKE '%mailsprache%' OR key LIKE 'forgot-password|%' OR key LIKE 'bestaetigung-erneut|%'",
  );
  const konten = {};
  for (const [sprache, bestaetigt] of [
    ['en', true],
    ['de', true],
    ['en', false],
  ]) {
    const n = `${NAME}_${sprache}_${bestaetigt ? 'ok' : 'neu'}`;
    // Ein offenes Konto der Registrierung trägt die Adresse erst als email_neu.
    const id = bestaetigt
      ? (
          await db.get(
            `INSERT INTO users (username, email, password_hash, is_active, email_verified)
          VALUES ($1, $2, 'x', true, true) RETURNING id`,
            [n, `${n}@example.org`],
          )
        ).id
      : (
          await db.get(
            `INSERT INTO users (username, email_neu, password_hash, is_active, email_verified, registrierung_offen)
          VALUES ($1, $2, 'x', true, false, true) RETURNING id`,
            [n, `${n}@example.org`],
          )
        ).id;
    await db.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'language', $2)`, [id, sprache]);
    konten[n] = `${n}@example.org`;
  }
  const zurueck = await mailserverEintragen(db);
  t.after(async () => {
    await zurueck();
    await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
  });
  const { base } = require('./helpers/server').testServer(_req, { routen: { '/api/v1/auth': 'routes/auth.js' }, t });
  const post = (pfad, email) =>
    fetch(`${base}/api/v1/auth${pfad}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-language': 'de' },
      body: JSON.stringify({ email }),
    });
  const mailAn = async adresse => {
    assert.ok(await bis(() => gesendet.some(m => m.to === adresse), 15_000), `keine Mail an ${adresse}`);
    return gesendet.find(m => m.to === adresse);
  };
  // Die Anfrage kommt auf Deutsch; massgeblich ist die Sprache des Empfängers.
  for (const [n, adresse] of Object.entries(konten).filter(([n]) => n.endsWith('_ok'))) {
    assert.equal((await post('/forgot-password', adresse)).status, 200);
    const mail = await mailAn(adresse);
    assert.match(
      mail.subject + mail.text,
      n.includes('_en_') ? /Reset|password/i : /Passwort/,
      `${n}: ${mail.subject}`,
    );
    if (n.includes('_en_')) assert.doesNotMatch(mail.subject, /Passwort|zurücksetzen/, mail.subject);
  }
  const neu = Object.entries(konten).find(([n]) => n.endsWith('_neu'))[1];
  assert.equal((await post('/bestaetigung-erneut', neu)).status, 200);
  const bestaetigung = await mailAn(neu);
  assert.doesNotMatch(bestaetigung.subject, /bestätig|Bestätig/, bestaetigung.subject);
});

test('4. die Alarmmail trägt dieselbe Hülle wie die anderen', async t => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  const _req = require('./helpers/sources').buildAndRequire();
  const db = await require('./helpers/db').dbOderSkip(t, _req);
  if (!db) return;
  const { baueAlarmMail, emailTemplate } = _req('src/mail/mailer.js');
  const mail = await baueAlarmMail({
    lang: 'en',
    username: 'anna',
    setNumber: '10294-1',
    setName: 'Titanic',
    condition: 'N',
    richtung: 'unter',
    preis: 600,
    schwelle: 650,
    waehrung: 'EUR',
  });
  // Klartext für Programme, die nur ihn zeigen, und HTML aus der gemeinsamen Vorlage.
  assert.match(mail.text, /^Hi anna,/);
  assert.match(mail.subject, /^Price alert: 10294-1 is below EUR 650\.00/);
  assert.notEqual(mail.html, mail.text);
  const huelle = emailTemplate('x', 'y', 'z').slice(0, 60);
  assert.ok(mail.html.startsWith(huelle), 'Die Alarmmail läuft nicht durch emailTemplate()');
});

test.after(() =>
  require('./helpers/sources')
    .buildAndRequire()('db/database.js')
    .pool.end()
    .catch(() => {}),
);
