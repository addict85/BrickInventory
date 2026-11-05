/**
 * Die E-Mail-Verifikation steht nur noch an EINER Stelle.
 * Ausführlich: docs/begruendungen/test/email-verify.test.js.md#kopf
 *
 * ── Gegenprobe (04.11.2026 gemessen) ────────────────────────────────────────
 * Die Abfrage aus uebernimmEmailNeu() zusätzlich als eigene Funktion in
 * src/konto/repository/zugaenge.ts → rot: „die Verifikationsabfrage steht genau
 * einmal im Baum" (nennt beide Fundstellen).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { ROOT, ohneKommentare, pruefeParameter } = require('./helpers/sources');

const lies = (rel) => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// Die Abfrage, die den Token EINLÖST: Registrierung und neue Adresse tragen
// ihn seit Runde 13 beide in email_neu_token (verification_token ist leer).
const ABFRAGE = /email_neu_token\s*=\s*\$1\s+AND\s+email_neu_bis\s*>\s*NOW\(\)/;
const EINLOESEN = /email_verified\s*=\s*true/i;
const KANDIDATEN = ['src/konto/auth.ts', 'src/konto/repository/zugaenge.ts', 'src/konto/repository/konten.ts', 'server.ts', 'routes/auth.ts', 'routes/auth/registrierung.ts'];

test('E-Mail-Verifikation steht nur an einer Stelle', async (t) => {

  await t.test('verifiziereEmailToken nimmt den rohen Token entgegen', () => {
    // pruefeParameter statt eines Musters über den ganzen Kopf: Eine
    // Typannotation zu ergänzen ist eine Verbesserung und darf keinen Test
    // umwerfen.
    pruefeParameter(lies('src/konto/auth.ts'), 'verifiziereEmailToken', ['token'],
      'die gemeinsame Verifikationslogik');
  });

  await t.test('die Verifikationsabfrage steht genau einmal im Baum', () => {
    const treffer = KANDIDATEN.filter((rel) => ABFRAGE.test(lies(rel)));
    assert.deepEqual(treffer, ['src/konto/repository/konten.ts'],
      'Die Abfrage nach email_neu_token gehört ausschliesslich in ' +
      'uebernimmEmailNeu(). Gefunden in: ' + treffer.join(', ') +
      ' — damit ist die Doppelung aus einer früheren Runde zurück.');
  });

  await t.test('das Einlösen (email_verified=true) steht genau einmal im Baum', () => {
    const treffer = KANDIDATEN.filter((rel) => EINLOESEN.test(lies(rel)));
    assert.deepEqual(treffer, ['src/konto/repository/konten.ts'],
      'Auch das Setzen von email_verified gehört nur an eine Stelle. ' +
      'Gefunden in: ' + treffer.join(', '));
  });

  await t.test('der eine verbleibende Weg ruft die gemeinsame Funktion', () => {
    // Einziger Weg ist POST /api/v1/auth/email-bestaetigen (der Knopf auf der
    // Seite hinter dem Mail-Link). GET /verify in server.ts liefert nur die
    // Seite; löste er wieder selbst ein, bestätigte schon ein Link-Scanner.
    // Das Verhalten prüft sicherheit-runde11-db am echten Server.
    assert.match(lies('routes/auth/registrierung.ts'), /verifiziereEmailToken\s*\(/,
      'routes/auth/registrierung.ts löst den Token nicht über die gemeinsame Funktion ein');
    assert.doesNotMatch(lies('server.ts'), /verifiziereEmailToken\s*\(/,
      'server.ts löst wieder selbst Token ein — der Link allein bestätigte dann');
  });

  // „der API-Weg antwortet NICHT mit einer Weiterleitung" ist entfallen
  // Ausführlich: docs/begruendungen/test/email-verify.test.js.md#stelle
});
