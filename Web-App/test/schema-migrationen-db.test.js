/**
 * Schema-Änderungen gehören in db/migrations/ — nicht in initSchema().
 * Ausführlich: docs/begruendungen/test/schema-migrationen-db.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');

/** Gemessen am Tag der Behebung. Die Zahl darf nur kleiner werden. */
const BESTAND_ALTER = 0;

test('keine neue Spalten-Änderung in db/database.ts', () => {
  const quelle = ohneKommentare(fs.readFileSync(path.join(ROOT, 'db/database.ts'), 'utf8'));
  const treffer = quelle.match(/ALTER TABLE \w+ ADD COLUMN/g) || [];

  assert.ok(treffer.length <= BESTAND_ALTER,
    `db/database.ts hat ${treffer.length} "ALTER TABLE … ADD COLUMN", erlaubt sind höchstens `
    + `${BESTAND_ALTER}. Eine NEUE Spalte gehört nach db/migrations/ — initSchema() läuft nur `
    + `bei einer Versionsänderung, und ein stiller Fehlschlag dort ist dauerhaft. Genau so ist `
    + `api_tokens.sliding im Betrieb ausgeblieben und hat die Anmeldung zerlegt.`);

  // Seit db/basis.sql steht in db/database.ts gar kein Schema mehr; das
  // Muster prüft die Gegenprobe an einem Beispiel, damit es nicht leerläuft.
  assert.equal(('x ALTER TABLE foo ADD COLUMN bar'.match(/ALTER TABLE \w+ ADD COLUMN/g) || []).length, 1);
});

test('api_tokens.sliding steht in einer Migration', () => {
  const verzeichnis = path.join(ROOT, 'db/migrations');
  const dateien = fs.readdirSync(verzeichnis).filter(f => f.endsWith('.sql'));
  const mitSliding = dateien.filter(f =>
    /ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS sliding/i.test(
      fs.readFileSync(path.join(verzeichnis, f), 'utf8')));

  assert.equal(mitSliding.length, 1,
    `Die Spalte api_tokens.sliding wird in ${mitSliding.length} Migrationen angelegt — erwartet `
    + `genau eine. Ohne sie scheitert createToken() auf jeder gewachsenen Datenbank, und damit `
    + `Login und QR-Login. Gefunden: ${mitSliding.join(', ') || '(keine)'}`);

  // Und die Spalte muss auch in der Basis stehen, sonst fehlt sie bei einer
  // NEUEN Installation, deren Migrationen alle als angewandt gelten.
  const basis = fs.readFileSync(path.join(ROOT, 'db/basis.sql'), 'utf8');
  assert.match(basis, /sliding boolean/,
    'db/basis.sql kennt die Spalte sliding nicht — dann fehlt sie auf einer frischen Installation.');
});
