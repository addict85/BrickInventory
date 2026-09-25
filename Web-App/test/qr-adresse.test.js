/**
 * Der QR-Code trägt die Adresse, unter der der Server von AUSSEN erreichbar
 * ist — nicht die aus der Browserzeile.
 *
 * ── Marcos Wunsch vom 25.09. ────────────────────────────────────────────────
 *
 *   „Kannst diese variable auch gleich für den qr Code für die Verknüpfung der
 *    App verwenden?"
 *
 * Gemeint ist APP_BASE_URL, dieselbe Quelle wie für die Links in den Mails.
 *
 * ── Warum das mehr ist als eine Vereinheitlichung ───────────────────────────
 *
 * Der Code trug `window.location.origin`. Das ist genau dann falsch, wenn es
 * darauf ankommt: Wer die Webapp über die LAN-Adresse oder einen lokalen Namen
 * öffnet (http://192.168.x.x:3000), reicht dem Telefon eine Adresse, die
 * ausser Haus nicht existiert. Scannen lässt sich der Code trotzdem — die App
 * verbindet sich einmal im WLAN und findet den Server unterwegs nie wieder.
 *
 * Das ist der unangenehmste Fehlertyp: Er entsteht im Wohnzimmer und zeigt
 * sich im Zug.
 *
 * ── Warum der Rückfall auf location.origin bleibt ───────────────────────────
 *
 * Ohne APP_BASE_URL ist die Adresse im Browser die einzige, die überhaupt
 * jemand kennt. Anders als bei einem Link in einer Mail ist sie hier keine
 * geratene: Der Benutzer steht ja gerade darauf. Deshalb liefert der Server
 * `null` statt eines Host-Header-Rückfalls, und der Klient entscheidet.
 *
 * ── Gegenproben (durchgeführt, Ergebnis im Commit) ──────────────────────────
 *   a) `url` aus der Antwort entfernt            → Schritt 1 rot.
 *   b) location.origin wieder fest verdrahtet    → Schritt 2 rot.
 *   c) Rückfall auf den Host-Header im Server    → Schritt 1 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, ohneKommentare } = require('./helpers/sources');

const lies = (rel) => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

test('1. der Server nennt die kanonische Adresse — oder null', () => {
  const auth = lies('routes/auth.ts');
  const i = auth.indexOf("router.post('/qr-token'");
  assert.ok(i > 0, 'Die Route /qr-token ist verschwunden — umbenannt?');
  const rumpf = auth.slice(i, auth.indexOf('\nrouter.', i + 10));

  assert.match(rumpf, /process\.env\.APP_BASE_URL/,
    'Die Antwort nennt APP_BASE_URL nicht — der Code trägt weiter die Browseradresse.');
  assert.match(rumpf, /url: basis/,
    'Die Adresse steht nicht in der Antwort.');
  // Kein geratener Host: Für diesen Code gilt dasselbe wie für einen Link in
  // einer Mail. Der Klient entscheidet, wenn nichts konfiguriert ist.
  assert.ok(!/headers\['x-forwarded-host'\]|headers\.host/.test(rumpf),
    'Die Route fällt auf den Host-Header zurück — genau das soll sie nicht.');
  // Ein abschliessender Schrägstrich in der Variablen darf sich nicht in die
  // Adresse durchschlagen.
  assert.match(rumpf, /replace\(\/\\\/\+\$\/, ''\)/,
    'Ein abschliessender Schrägstrich wird nicht entfernt.');
});

test('2. und die Webapp benutzt sie', () => {
  const js = lies('public/js/05-settings.js');
  assert.match(js, /const serverUrl = \(d\.url \|\| window\.location\.origin\)/,
    'Die Webapp nimmt die Adresse des Servers nicht — oder hat keinen Rückfall mehr.');

  // Das versteckte Feld ist entfallen: Es trug nur location.origin weiter und
  // war nie zu bearbeiten. Eine Zeile, die niemand mehr braucht, ist eine
  // Stelle, an der jemand später etwas Falsches vermutet.
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(!/id="qr-server-url"/.test(html),
    'Das verwaiste Feld qr-server-url steht noch im Markup.');
  assert.ok(!/qr-server-url/.test(js.replace(/\/\/[^\n]*/g, '')),
    'Die Webapp liest das entfallene Feld noch.');
});

test('3. dieselbe Quelle wie die Links in den Mails', () => {
  // Der Kern von Marcos Wunsch: EINE Adresse, nicht zwei. Kämen QR-Code und
  // Mail aus verschiedenen Quellen, zeigte eines von beiden irgendwann woanders
  // hin — und niemand wüsste, welches von beiden recht hat.
  for (const [datei, quelle] of [
    ['utils/mailer.ts', lies('utils/mailer.ts')],
    ['routes/auth.ts',  lies('routes/auth.ts')],
  ]) {
    assert.match(quelle, /process\.env\.APP_BASE_URL/,
      `${datei} kennt APP_BASE_URL nicht mehr.`);
  }
  // Und sie ist dokumentiert — sonst weiss niemand, dass es sie zu setzen gilt.
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /APP_BASE_URL/, 'README.md nennt APP_BASE_URL nicht.');
});
