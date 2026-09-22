/**
 * Die Fusszeilen der vier Detail-Dialoge — was dort steht und wie gross es ist.
 *
 * ── Marcos Meldungen ────────────────────────────────────────────────────────
 *
 *   „Der Papierkorb im Detaildialog der Teile ist kleiner als auf den anderen
 *    Detaildialogen." — dasselbe noch einmal fuer die Minifiguren.
 *   „Im Detaildialog der Sets sollen die Button Auf BrickLink kaufen und
 *    Preisvergleich nicht angezeigt werden."
 *   „Der Detaildialog der Teile hat ein zurueck Button diesen bitte
 *    entfernen." — dasselbe noch einmal fuer die Minifiguren.
 *
 * ── Warum das eine Regel wert ist ───────────────────────────────────────────
 *
 * Alle drei Befunde sind Abweichungen, die NACHGEMESSEN wurden und die man
 * beim Lesen des Markups nicht sieht:
 *
 *   * `btn-sm` neben `btn bd` macht aus 53x38px ein kleineres Feld
 *     (styles.css: .btn 9px/17px, .btn-sm 5px/11px). Der Unterschied faellt
 *     nur auf, wenn man zwei Dialoge NEBENEINANDER haelt — genau das tut
 *     dieser Test.
 *   * Ein Knopf, den man aus einem Dialog entfernt, kommt beim naechsten
 *     „analog zum Set-Detail" gern zurueck.
 *
 * Teile und Minifiguren teilen sich EINEN Dialog (#man-detail-modal). Marcos
 * zwei Meldungen sind deshalb ein Fund, nicht zwei — und eine Regel.
 *
 * Gegenproben (alle drei durchgefuehrt):
 *   1. `btn-sm` an #man-detail-del zurueckgesetzt  → Schritt 1 rot.
 *   2. Den BrickLink-Knopf ins Set-Modal zurueckkopiert → Schritt 2 rot.
 *   3. Den „Zurueck"-Knopf in #man-detail-modal wieder eingesetzt → Schritt 3 rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ohneKommentare } = require('./helpers/sources');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

/** Den Rumpf eines Dialogs anhand seiner id herausschneiden. */
function dialog(id) {
  const ab = html.indexOf(`id="${id}"`);
  assert.ok(ab > 0, `Dialog #${id} nicht gefunden — Markup umgebaut?`);
  // Bis zum naechsten Dialog-Anfang; der letzte reicht bis zum Dateiende.
  const naechster = html.indexOf('<div class="ovl"', ab);
  return html.slice(ab, naechster > 0 ? naechster : html.length);
}

// Die drei Dialoge mit Papierkorb. Der vierte (#setitem-modal, Teile AUS
// Sets) hat keinen: Was zu einem Set gehoert, loescht man ueber das Set.
const MIT_PAPIERKORB = [
  ['Set-Detail',        'set-modal',        'btn-md'],
  ['Merkposten-Detail', 'mk-detail-modal',  'mk-m-del'],
  ['Teile/Figuren',     'man-detail-modal', 'man-detail-del'],
];

test('der Papierkorb ist in jedem Detail-Dialog gleich gross', () => {
  for (const [name, modal, knopf] of MIT_PAPIERKORB) {
    const zeile = dialog(modal).split('\n').find(z => z.includes(`id="${knopf}"`));
    assert.ok(zeile, `${name}: der Papierkorb #${knopf} fehlt`);
    const klassen = /class="([^"]*)"/.exec(zeile)?.[1] ?? '';
    assert.ok(klassen.includes('btn') && klassen.includes('bd'),
      `${name}: #${knopf} traegt nicht mehr „btn bd" (${klassen})`);
    assert.ok(!klassen.includes('btn-sm'),
      `${name}: #${knopf} traegt „btn-sm" und ist damit kleiner als in den ` +
      'anderen Detail-Dialogen — genau Marcos Befund.');
  }
});

test('das Set-Detail zeigt keine Kaufadressen mehr', () => {
  // Beide Knoepfe stehen weiterhin im Katalog- und im Merkposten-Detail:
  // Kaufen will, wer das Set noch NICHT hat. Der Test prueft deshalb nicht
  // „nirgends", sondern „nicht HIER".
  const set = dialog('set-modal');
  for (const id of ['m-bricklink', 'm-vergleich']) {
    assert.ok(!set.includes(`id="${id}"`),
      `Das Set-Detail zeigt wieder #${id}. Marcos Vorgabe: dort keine Kaufadressen.`);
  }
  // Und die Gegenrichtung, damit der Test nicht durch Loeschen gruen wird:
  // Wo sie hingehoeren, muessen sie noch stehen.
  for (const [modal, id] of [['cat-modal', 'cat-m-bricklink'],
                             ['mk-detail-modal', 'mk-m-bricklink'],
                             ['mk-detail-modal', 'mk-m-vergleich']]) {
    assert.ok(dialog(modal).includes(`id="${id}"`),
      `#${id} fehlt in #${modal} — dort gehoert die Adresse hin.`);
  }
});

test('der Teile-/Figuren-Dialog hat keinen zweiten Weg hinaus', () => {
  // Das ✕ im Kopf schliesst den Dialog. Ein „Zurueck" in der Fusszeile war
  // derselbe Griff ein zweites Mal.
  const man = dialog('man-detail-modal');
  const fuss = man.slice(man.indexOf('class="mfooter"'));
  assert.ok(!fuss.includes('acq.back'),
    'Der „Zurueck"-Knopf steht wieder in der Fusszeile des Teile-/Figuren-Dialogs.');
  assert.ok(man.includes('data-click="closeManDetail"'),
    'Ohne ✕ im Kopf waere der Dialog jetzt eine Sackgasse.');
});

/**
 * Dieselbe Regel fuer die App — die Detail-Bildschirme tragen den Papierkorb
 * an derselben Stelle.
 *
 * ── Warum das hier steht und nicht in Kotlin ────────────────────────────────
 *
 * Weil die Regel BEIDE Oberflaechen meint. Ein Kotlin-Test kennt die Webapp
 * nicht, und zwei getrennte Tests haetten genau den Fehler gemacht, den sie
 * verhindern sollen: Jeder haette fuer sich recht behalten, waehrend die
 * Oberflaechen auseinanderlaufen. Der Baum prueft Kotlin-Quelltext an
 * mehreren Stellen von hier aus (app-compose-importe.test.js,
 * catalog-local-images.test.js) — das ist die vorhandene Bauart, keine neue.
 *
 * In der App ist die Abweichung eine andere als in der Webapp: Nicht die
 * GROESSE lief auseinander (alle drei benutzen IconButton mit der
 * Vorgabegroesse), sondern der ORT. Das Merkposten-Detail hatte als einziges
 * keinen Papierkorb in der Kopfleiste, sondern einen Textknopf ganz unten.
 *
 * `ohneKommentare()` ist hier nicht Zierde, sondern die Regel selbst: Ohne
 * das Abstreifen haette der erste Versuch dieses Tests einen
 * AUSKOMMENTIERTEN Papierkorb als vorhanden gezaehlt — die Gegenprobe blieb
 * gruen, und genau daran ist sie aufgefallen. Der Helfer traegt dieselbe
 * Warnung im Kopf; sie hat sich hier zum wiederholten Mal bewahrheitet.
 *
 * Gegenproben (beide durchgefuehrt): `actions`-Block im
 * MerkpostenDetailScreen einmal auskommentiert und einmal ganz geloescht →
 * dieser Schritt wird beide Male rot.
 */
test('jeder Detail-Bildschirm der App traegt den Papierkorb in der Kopfleiste', () => {
  const app = path.join(__dirname, '..', '..', 'Android-App', 'app', 'src', 'main',
                        'java', 'ch', 'brickinventoryapp', 'ui');
  const SCHIRME = [
    ['Set-Detail',        path.join(app, 'screens', 'SetDetailScreen.kt')],
    ['Teile/Figuren',     path.join(app, 'screens', 'ManualItemDetailScreen.kt')],
    ['Merkposten-Detail', path.join(app, 'screens', 'MerkpostenDetailScreen.kt')],
  ];
  for (const [name, datei] of SCHIRME) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    // Der Kopf reicht vom TopAppBar bis zum Rumpf des Scaffolds.
    const ab = src.indexOf('TopAppBar(');
    assert.ok(ab > 0, `${name}: keine Kopfleiste gefunden — Bildschirm umgebaut?`);
    const kopf = src.slice(ab, src.indexOf('    ) { padding', ab) + 1 || src.length);
    assert.ok(/actions\s*=\s*\{/.test(kopf),
      `${name}: die Kopfleiste hat keinen actions-Block — wo steht der Papierkorb?`);
    assert.ok(kopf.includes('Icons.Default.Delete'),
      `${name}: kein Papierkorb in der Kopfleiste. In den anderen Detail-Bildschirmen ` +
      'steht er dort; ein Loeschknopf woanders ist genau Marcos Befund aus der Webapp.');
    assert.ok(kopf.includes('IconButton('),
      `${name}: der Papierkorb ist kein IconButton — damit hat er eine andere Groesse ` +
      'als in den uebrigen Detail-Bildschirmen.');
  }
});
