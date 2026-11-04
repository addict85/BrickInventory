/**
 * Die E-Mail-Verifikation steht nur noch an EINER Stelle.
 *
 * ── Der Befund (Nachtrag 154) ───────────────────────────────────────────────
 * Dieselben acht Zeilen standen zweimal im Baum: in server.ts unter
 * `GET /verify` (der Link aus der Mail) und in routes/auth.ts unter
 * `GET /api/auth/verify`. Beide Kopien trugen die Hash-Regel, die
 * Ablaufprüfung und das Abräumen der Token-Felder. Wer eine änderte, übersah
 * die andere — und gemerkt hätte man es erst, wenn ein Nutzer sich nicht mehr
 * verifizieren kann.
 *
 * Diese Regel hält fest, dass die Zusammenführung hält. Sie prüft die
 * ABSICHT, nicht den Wortlaut: dass die Abfrage genau einmal vorkommt und
 * dass beide Routen die gemeinsame Funktion rufen — nicht, wie deren
 * Signatur ausbuchstabiert ist.
 *
 * ── Gegenprobe (durchgeführt) ───────────────────────────────────────────────
 * Die SQL-Zeile aus src/konto/auth.ts wurde versuchsweise zurück in die Route in
 * server.ts kopiert. Ergebnis: „die Verifikationsabfrage steht genau einmal
 * im Baum" wird rot und nennt beide Fundstellen. Zurückgebaut, Regel wieder
 * grün. Ohne diesen Schritt wäre die Regel nur eine Behauptung.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');
const { ROOT, ohneKommentare, pruefeParameter } = require('./helpers/sources');

const lies = (rel) => ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

// Die Abfrage, die den Token EINLÖST — erkennbar an der Bedingung
// `NOT email_verified`. Bewusst am Spaltennamen festgemacht und nicht am
// ganzen SQL-Text: Ob dort SELECT id oder SELECT * steht, ist für die Aussage
// gleichgültig.
//
// ── Warum die Bedingung Teil des Musters ist ────────────────────────────────
// Ein erster Entwurf suchte nur nach `verification_token = $1`. Damit schlug
// die Regel bei GET /api/auth/check-token an — und das ZU UNRECHT: Diese
// Route fragt nur, OB ein Token noch gilt, sie löst ihn nicht ein. Sie lässt
// `NOT email_verified` deshalb bewusst weg, weil sie dieselbe Antwort auch
// für Rücksetz-Tokens gibt. Prüfen und Einlösen sind zwei Dinge; eine Regel,
// die beides in einen Topf wirft, meldet Verstösse, die keine sind — und wird
// beim nächsten Mal abgeschaltet statt befolgt.
const ABFRAGE = /verification_token\s*=\s*\$1[\s\S]{0,120}?NOT email_verified/;
const EINLOESEN = /UPDATE\s+users\s+SET\s+email_verified\s*=\s*true/i;

test('E-Mail-Verifikation steht nur an einer Stelle', async (t) => {

  await t.test('verifiziereEmailToken nimmt den rohen Token entgegen', () => {
    // pruefeParameter statt eines Musters über den ganzen Kopf: Eine
    // Typannotation zu ergänzen ist eine Verbesserung und darf keinen Test
    // umwerfen (siehe Nachträge 148 und 150).
    pruefeParameter(lies('src/konto/auth.ts'), 'verifiziereEmailToken', ['token'],
      'die gemeinsame Verifikationslogik');
  });

  await t.test('die Verifikationsabfrage steht genau einmal im Baum', () => {
    const kandidaten = ['src/konto/auth.ts', 'src/konto/repository/zugaenge.ts', 'server.ts', 'routes/auth.ts'];
    const treffer = kandidaten.filter((rel) => ABFRAGE.test(lies(rel)));
    assert.deepEqual(treffer, ['src/konto/repository/zugaenge.ts'],
      'Die Abfrage nach verification_token gehört ausschliesslich in ' +
      'utils/auth.verifiziereEmailToken(). Gefunden in: ' + treffer.join(', ') +
      ' — damit ist die Doppelung aus Nachtrag 154 zurück.');
  });

  await t.test('das Einlösen (email_verified=true) steht genau einmal im Baum', () => {
    const kandidaten = ['src/konto/auth.ts', 'src/konto/repository/zugaenge.ts', 'server.ts', 'routes/auth.ts'];
    const treffer = kandidaten.filter((rel) => EINLOESEN.test(lies(rel)));
    assert.deepEqual(treffer, ['src/konto/repository/zugaenge.ts'],
      'Auch das Setzen von email_verified gehört nur an eine Stelle. ' +
      'Gefunden in: ' + treffer.join(', '));
  });

  await t.test('der eine verbleibende Weg ruft die gemeinsame Funktion', () => {
    // Einziger Weg ist POST /api/v1/auth/email-bestaetigen (der Knopf auf der
    // Seite hinter dem Mail-Link). GET /verify in server.ts liefert nur die
    // Seite; löste er wieder selbst ein, bestätigte schon ein Link-Scanner.
    // Das Verhalten prüft sicherheit-runde11-db am echten Server.
    assert.match(lies('routes/auth.ts'), /verifiziereEmailToken\s*\(/,
      'routes/auth.ts löst den Token nicht über die gemeinsame Funktion ein');
    assert.doesNotMatch(lies('server.ts'), /verifiziereEmailToken\s*\(/,
      'server.ts löst wieder selbst Token ein — der Link allein bestätigte dann');
  });

  // ── „der API-Weg antwortet NICHT mit einer Weiterleitung" ist entfallen ──
  //
  // Der Untertest hielt fest, dass GET /api/auth/verify mit JSON antwortet
  // statt mit res.redirect — ein Programm-Aufrufer bekaeme sonst die ~189 KB
  // index.html. Die Route ist entfernt, weil sie keinen Aufrufer hatte; die
  // Regel darueber, die eine zweite Fassung der Logik verbietet, deckt den
  // Rueckfall ab.
});
