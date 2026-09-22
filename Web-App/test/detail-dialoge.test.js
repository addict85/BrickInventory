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
