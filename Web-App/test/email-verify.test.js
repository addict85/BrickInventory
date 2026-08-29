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
 * Die SQL-Zeile aus utils/auth.ts wurde versuchsweise zurück in die Route in
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
// `email_verified = 0`. Bewusst am Spaltennamen festgemacht und nicht am
// ganzen SQL-Text: Ob dort SELECT id oder SELECT * steht, ist für die Aussage
// gleichgültig.
//
// ── Warum die Bedingung Teil des Musters ist ────────────────────────────────
// Ein erster Entwurf suchte nur nach `verification_token = $1`. Damit schlug
// die Regel bei GET /api/auth/check-token an — und das ZU UNRECHT: Diese
// Route fragt nur, OB ein Token noch gilt, sie löst ihn nicht ein. Sie lässt
// `email_verified = 0` deshalb bewusst weg, weil sie dieselbe Antwort auch
// für Rücksetz-Tokens gibt. Prüfen und Einlösen sind zwei Dinge; eine Regel,
// die beides in einen Topf wirft, meldet Verstösse, die keine sind — und wird
// beim nächsten Mal abgeschaltet statt befolgt.
const ABFRAGE = /verification_token\s*=\s*\$1[\s\S]{0,120}?email_verified\s*=\s*0/;
const EINLOESEN = /UPDATE\s+users\s+SET\s+email_verified\s*=\s*1/i;

test('E-Mail-Verifikation steht nur an einer Stelle', async (t) => {

  await t.test('verifiziereEmailToken nimmt den rohen Token entgegen', () => {
    // pruefeParameter statt eines Musters über den ganzen Kopf: Eine
    // Typannotation zu ergänzen ist eine Verbesserung und darf keinen Test
    // umwerfen (siehe Nachträge 148 und 150).
    pruefeParameter(lies('utils/auth.ts'), 'verifiziereEmailToken', ['token'],
      'die gemeinsame Verifikationslogik');
  });

  await t.test('die Verifikationsabfrage steht genau einmal im Baum', () => {
    const kandidaten = ['utils/auth.ts', 'server.ts', 'routes/auth.ts'];
    const treffer = kandidaten.filter((rel) => ABFRAGE.test(lies(rel)));
    assert.deepEqual(treffer, ['utils/auth.ts'],
      'Die Abfrage nach verification_token gehört ausschliesslich in ' +
      'utils/auth.verifiziereEmailToken(). Gefunden in: ' + treffer.join(', ') +
      ' — damit ist die Doppelung aus Nachtrag 154 zurück.');
  });

  await t.test('das Einlösen (email_verified=1) steht genau einmal im Baum', () => {
    const kandidaten = ['utils/auth.ts', 'server.ts', 'routes/auth.ts'];
    const treffer = kandidaten.filter((rel) => EINLOESEN.test(lies(rel)));
    assert.deepEqual(treffer, ['utils/auth.ts'],
      'Auch das Setzen von email_verified gehört nur an eine Stelle. ' +
      'Gefunden in: ' + treffer.join(', '));
  });

  await t.test('beide Routen rufen die gemeinsame Funktion', () => {
    for (const rel of ['server.ts', 'routes/auth.ts']) {
      assert.match(lies(rel), /verifiziereEmailToken\s*\(/,
        `${rel} löst den Token nicht über die gemeinsame Funktion ein`);
    }
  });

  await t.test('der Browser-Weg antwortet mit einer Weiterleitung', () => {
    // Der Link wird aus einer E-Mail angeklickt — am Ende muss eine Seite
    // stehen. Beide Ausgänge (?verified=1 und ?verified=invalid) werden von
    // der Oberfläche ausgewertet; fällt einer weg, meldet die Seite nichts.
    const s = lies('server.ts');
    assert.match(s, /verified=1/,       'server.ts meldet den Erfolg nicht mehr');
    assert.match(s, /verified=invalid/, 'server.ts meldet den Fehlschlag nicht mehr');
  });

  await t.test('der API-Weg antwortet NICHT mit einer Weiterleitung', () => {
    // ── Warum das hier steht (Nachtrag 154) ───────────────────────────────
    // Vorher schickte /api/auth/verify auf dem Erfolgs- UND dem
    // Ungültig-Pfad ein res.redirect('/?verified=…'). Ein fetch() folgt der
    // Weiterleitung und bekommt die ~189 KB index.html statt einer Antwort —
    // dieselbe Falle, die für unbekannte /api-Pfade schon einmal als
    // 404-Regel behoben wurde.
    const quelle = lies('routes/auth.ts');
    const i = quelle.indexOf("router.get('/verify'");
    assert.ok(i > 0, 'Die Route GET /verify gibt es in routes/auth.ts nicht mehr');
    // Nur der Rumpf dieser einen Route, nicht die ganze Datei.
    const rumpf = quelle.slice(i, quelle.indexOf('\nrouter.', i + 10));
    assert.doesNotMatch(rumpf, /res\.redirect/,
      'Eine Route unter /api darf nicht auf eine HTML-Seite weiterleiten — ' +
      'ein Programm-Aufrufer bekommt dann index.html statt einer Antwort.');
    assert.match(rumpf, /res\.json|\.json\(/, 'Die API-Route antwortet nicht mit JSON');
  });
});
