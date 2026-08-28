/**
 * Beide Oberflächen übernehmen die Menge aus der SERVERANTWORT.
 *
 * ── Warum es das Feld gibt ──────────────────────────────────────────────────
 * Angezeigt wird die Menge aller Konten, geschrieben wird die Differenz auf das
 * eigene (Nachtrag 85). Beim VERRINGERN deckelt der Server bei den eigenen
 * Exemplaren — die eines anderen Kontos lassen sich nicht wegnehmen — und
 * antwortet mit der tatsächlichen Gesamtmenge.
 *
 * Beide Regler zählen ihre Zahl vorher hoch und schicken sie dann. Ohne die
 * Übernahme stünde nach einem gedeckelten Verringern die eigene Annahme im
 * Feld, bis jemand die Ansicht neu öffnet: Der Server hat recht, der Bildschirm
 * zeigt etwas anderes, und niemand merkt es.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 * Die REGEL in beiden Clients, nicht die Zahl — die prüft
 * set-quantity-household-db gegen die echte Datenbank. Hier geht es darum, dass
 * das gelieferte Feld auch GELESEN wird. Genau diese Lücke ist in diesem
 * Projekt schon zweimal aufgefallen (die Verschiebe-Zahlen in Nachtrag 65, das
 * Zustands-Aggregat davor): Der Server liefert seit jeher etwas mit, und die
 * Oberfläche liest es nie.
 *
 * Gegenprobe (durchgeführt): in 02-gallery.js `const echt = qty` gesetzt →
 * der Webapp-Teilschritt wird rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');

test('die Webapp übernimmt die Menge aus der Antwort', () => {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/js/02-gallery.js'), 'utf8'));
  const fn = src.slice(src.indexOf('export function autosaveSet'),
                       src.indexOf('G(\'btn-md\').onclick'));
  assert.match(fn, /d\.quantity/,
    'autosaveSet liest die Menge der Antwort nicht — nach einem gedeckelten ' +
    'Verringern bliebe die eigene Annahme im Feld stehen');
  assert.match(fn, /G\('m-qty'\)\.value = /,
    'Das Eingabefeld wird nicht korrigiert');
  assert.doesNotMatch(fn, /curSet\.quantity = qty;/,
    'Der gemerkte Stand darf nicht die GESENDETE Zahl sein, sondern die bestätigte');
});

test('die Route liefert die Menge überhaupt mit', () => {
  // Ohne diese Prüfung könnte das Feld serverseitig verschwinden, und die
  // beiden Clients fielen still auf ihre eigene Annahme zurück — der Rückfall
  // ist absichtlich lautlos, damit ein älterer Server keine Fehlermeldung
  // erzeugt. Genau deshalb braucht es hier eine Prüfung.
  const v1 = ohneKommentare(fs.readFileSync(path.join(ROOT, 'routes/api_v1/sets.ts'), 'utf8'));
  const route = v1.slice(v1.indexOf("router.put('/sets/:setNumber'"),
                         v1.indexOf("router.delete('/sets/:setNumber'"));
  assert.match(route, /const r = await updateSet\(/, 'Die Antwort von updateSet wird verworfen');
  assert.match(route, /\.\.\.\(r \|\| \{\}\)/, 'Sie wird nicht in die Antwort übernommen');

  const sets = ohneKommentare(require('./helpers/sources').setKernQuelle());
  // Seit Nachtrag 131 liegt updateSet in utils/setService.ts; die Route, die
  // früher den Ausschnitt begrenzte, steht in einer anderen Datei. Begrenzt
  // wird jetzt am Ende der Funktion selbst.
  const anfang = sets.indexOf('async function updateSet');
  const fn = sets.slice(anfang, sets.indexOf('\n}', anfang));
  assert.match(fn, /return \{ quantity: /,
    'updateSet gibt die Gesamtmenge nicht zurück');
  assert.match(fn, /SUM\(quantity\)[\s\S]{0,120}user_id = ANY/,
    'Die zurückgegebene Menge muss über das Blickfeld summiert sein — eine ' +
    'einzelne Kontozeile wäre wieder die alte Verwechslung');
});
