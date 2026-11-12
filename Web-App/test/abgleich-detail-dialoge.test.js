/**
 * Die Fusszeilen der vier Detail-Dialoge — was dort steht und wie gross es ist.
 *
 * Gegenproben (alle drei durchgefuehrt):
 *   1. `btn-sm` an #man-detail-del zurueckgesetzt  → Schritt 1 rot.
 *   2. Den BrickLink-Knopf ins Set-Modal zurueckkopiert → Schritt 2 rot.
 *   3. Den „Zurueck"-Knopf in #man-detail-modal wieder eingesetzt → Schritt 3 rot.
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
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
  ['Set-Detail', 'set-modal', 'btn-md'],
  ['Merkposten-Detail', 'mk-detail-modal', 'mk-m-del'],
  ['Teile/Figuren', 'man-detail-modal', 'man-detail-del'],
];

test('der Papierkorb ist in jedem Detail-Dialog gleich gross', () => {
  for (const [name, modal, knopf] of MIT_PAPIERKORB) {
    const zeile = dialog(modal)
      .split('\n')
      .find(z => z.includes(`id="${knopf}"`));
    assert.ok(zeile, `${name}: der Papierkorb #${knopf} fehlt`);
    const klassen = /class="([^"]*)"/.exec(zeile)?.[1] ?? '';
    assert.ok(
      klassen.includes('btn') && klassen.includes('bd'),
      `${name}: #${knopf} traegt nicht mehr „btn bd" (${klassen})`,
    );
    assert.ok(
      !klassen.includes('btn-sm'),
      `${name}: #${knopf} traegt „btn-sm" und ist damit kleiner als in den ` +
        'anderen Detail-Dialogen — genau Marcos Befund.',
    );
  }
});

test('das Set-Detail zeigt keine Kaufadressen mehr', () => {
  // Beide Knoepfe stehen weiterhin im Katalog- und im Merkposten-Detail:
  // Kaufen will, wer das Set noch NICHT hat. Der Test prueft deshalb nicht
  // „nirgends", sondern „nicht HIER".
  const set = dialog('set-modal');
  for (const id of ['m-bricklink', 'm-vergleich']) {
    assert.ok(
      !set.includes(`id="${id}"`),
      `Das Set-Detail zeigt wieder #${id}. Marcos Vorgabe: dort keine Kaufadressen.`,
    );
  }
  // Und die Gegenrichtung, damit der Test nicht durch Loeschen gruen wird:
  // Wo sie hingehoeren, muessen sie noch stehen.
  for (const [modal, id] of [
    ['cat-modal', 'cat-m-bricklink'],
    ['mk-detail-modal', 'mk-m-bricklink'],
    ['mk-detail-modal', 'mk-m-vergleich'],
  ]) {
    assert.ok(dialog(modal).includes(`id="${id}"`), `#${id} fehlt in #${modal} — dort gehoert die Adresse hin.`);
  }
});

test('der Teile-/Figuren-Dialog hat keinen zweiten Weg hinaus', () => {
  // Das ✕ im Kopf schliesst den Dialog. Ein „Zurueck" in der Fusszeile war
  // derselbe Griff ein zweites Mal.
  const man = dialog('man-detail-modal');
  const fuss = man.slice(man.indexOf('class="mfooter"'));
  assert.ok(
    !fuss.includes('acq.back'),
    'Der „Zurueck"-Knopf steht wieder in der Fusszeile des Teile-/Figuren-Dialogs.',
  );
  assert.ok(man.includes('data-click="closeManDetail"'), 'Ohne ✕ im Kopf waere der Dialog jetzt eine Sackgasse.');
});

/**
 * Dieselbe Regel fuer die App — die Detail-Bildschirme tragen den Papierkorb
 * an derselben Stelle.
 *
 * Gegenproben (beide durchgefuehrt): `actions`-Block im
 * MerkpostenDetailScreen einmal auskommentiert und einmal ganz geloescht →
 * dieser Schritt wird beide Male rot.
 */
test('jeder Detail-Bildschirm der App traegt den Papierkorb in der Kopfleiste', () => {
  const SCHIRME = [
    [
      'Set-Detail',
      path.join(
        __dirname,
        '..',
        '..',
        'Android-App',
        'feature-sammlung',
        'src',
        'main',
        'java',
        'ch',
        'brickinventoryapp',
        'sammlung',
        'ui',
        'screens',
        'SetDetailScreen.kt',
      ),
    ],
    [
      'Teile/Figuren',
      path.join(
        __dirname,
        '..',
        '..',
        'Android-App',
        'feature-teile',
        'src',
        'main',
        'java',
        'ch',
        'brickinventoryapp',
        'teile',
        'ui',
        'screens',
        'ManualItemDetailScreen.kt',
      ),
    ],
    [
      'Merkposten-Detail',
      path.join(
        __dirname,
        '..',
        '..',
        'Android-App',
        'feature-sammlung',
        'src',
        'main',
        'java',
        'ch',
        'brickinventoryapp',
        'sammlung',
        'ui',
        'screens',
        'MerkpostenDetailScreen.kt',
      ),
    ],
  ];
  for (const [name, datei] of SCHIRME) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    // Der Kopf reicht vom TopAppBar bis zum Rumpf des Scaffolds.
    const ab = src.indexOf('TopAppBar(');
    assert.ok(ab > 0, `${name}: keine Kopfleiste gefunden — Bildschirm umgebaut?`);
    const kopf = src.slice(ab, src.indexOf('    ) { padding', ab) + 1 || src.length);
    assert.ok(
      /actions\s*=\s*\{/.test(kopf),
      `${name}: die Kopfleiste hat keinen actions-Block — wo steht der Papierkorb?`,
    );
    assert.ok(
      kopf.includes('Icons.Default.Delete'),
      `${name}: kein Papierkorb in der Kopfleiste. In den anderen Detail-Bildschirmen ` +
        'steht er dort; ein Loeschknopf woanders ist genau Marcos Befund aus der Webapp.',
    );
    assert.ok(
      kopf.includes('IconButton('),
      `${name}: der Papierkorb ist kein IconButton — damit hat er eine andere Groesse ` +
        'als in den uebrigen Detail-Bildschirmen.',
    );
  }
});

/**
 * Titel- und Fussleiste der Dialoge bleiben beim Rollen stehen.
 *
 * Gegenproben (durchgefuehrt):
 *   a) Ein <div> um den Rumpf von #set-modal gelegt  -> Schritt 1 rot.
 *   b) `position:sticky` aus .mhd entfernt           -> Schritt 2 rot.
 *   c) Den negativen Versatz auf 0 gesetzt           -> Schritt 2 rot.
 *   d) Die Polster-Variablen aus .modal entfernt     -> Schritt 2 rot.
 */
test('Titel- und Fussleiste kleben — und koennen das auch', () => {
  // ── 1. Voraussetzung: direktes Kind des Rollbereichs ──────────────────────
  //
  // Gesucht, nicht aufgezaehlt: Jeder Dialog mit einer .mhd wird geprueft, ein
  // neuer ist damit von selbst dabei.
  const dialoge = [...html.matchAll(/<div class="ovl"[^>]*id="([\w-]+)"/g)].map(m => m[1]);
  assert.ok(
    dialoge.length >= 8,
    `Nur ${dialoge.length} Dialoge gefunden — Muster veraltet? Ohne Fund prueft der Rest nichts.`,
  );

  let mitLeiste = 0;
  for (const id of dialoge) {
    const rumpf = dialog(id);
    if (!/class="mhd"/.test(rumpf)) continue;
    mitLeiste++;
    // Zwischen `<div class="modal…">` und `<div class="mhd">` darf kein
    // weiteres oeffnendes <div> stehen.
    const abModal = rumpf.search(/<div class="modal/);
    assert.ok(abModal >= 0, `#${id}: kein .modal gefunden`);
    const bisKopf = rumpf.slice(abModal, rumpf.indexOf('<div class="mhd"'));
    const dazwischen = (bisKopf.match(/<div\b/g) || []).length - 1; // das .modal selbst abziehen
    assert.equal(
      dazwischen,
      0,
      `#${id}: zwischen .modal und .mhd liegen ${dazwischen} weitere <div>. ` +
        `position:sticky wirkt nur gegen den naechsten ROLLBEREICH, und das ist .modal ` +
        `(overflow-y:auto). Mit einem Element dazwischen hoert die Titelleiste ` +
        `stillschweigend auf zu kleben — kein Fehler, keine Warnung.`,
    );
  }
  assert.ok(mitLeiste >= 6, `Nur ${mitLeiste} Dialoge mit Titelleiste — zu wenig, da stimmt das Muster nicht mehr.`);

  // ── 2. Die Regeln selbst ──────────────────────────────────────────────────
  //
  // Kommentare raus, BEVOR gesucht wird: Die Erklaerbloecke in diesen Dateien
  // zitieren die Regeln, um die es geht („hier stand `.mhd { position:
  // sticky; top: 0 }`"). Ohne das meldet die Pruefung den Erklaertext als
  // Verstoss — genau das ist beim Schreiben dieser Datei passiert.
  const ohneCssKommentare = t => t.replace(/\/\*[\s\S]*?\*\//g, '');
  const css = ohneCssKommentare(fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8'));
  const regel = wahl => {
    const ab = css.indexOf(wahl + '{');
    assert.ok(ab > 0, `${wahl} nicht mehr in styles.css gefunden`);
    return css.slice(ab, css.indexOf('}', ab));
  };

  const kopf = regel('.mhd'),
    fuss = regel('.mfooter');
  assert.match(kopf, /position:sticky/, 'Die Titelleiste klebt nicht mehr.');
  assert.match(fuss, /position:sticky/, 'Die Fussleiste klebt nicht mehr.');
  assert.match(
    kopf,
    /top:calc\(var\(--modal-pady\) \* -1\)/,
    'Der Versatz der Titelleiste ist nicht mehr die negative Polsterung. Mit top:0 ' +
      'bleibt sie um genau diese Polsterung zu tief stehen — in Chromium gemessen: 28px.',
  );
  assert.match(
    fuss,
    /bottom:calc\(var\(--modal-padb\) \* -1\)/,
    'Der Versatz der Fussleiste ist nicht mehr die negative Polsterung.',
  );
  // Volle Breite: ohne die negativen Seitenraender bleibt links und rechts ein
  // Streifen, durch den der Inhalt sichtbar vorbeirollt.
  for (const [name, r] of [
    ['Titelleiste', kopf],
    ['Fussleiste', fuss],
  ])
    assert.match(
      r,
      /calc\(var\(--modal-padx\) \* -1\)/,
      `${name}: kein negativer Seitenrand — dann geht sie nicht ueber die volle Breite.`,
    );
  // Undurchsichtig, sonst scheint der Inhalt durch.
  for (const [name, r] of [
    ['Titelleiste', kopf],
    ['Fussleiste', fuss],
  ])
    assert.match(r, /background:var\(--sur\)/, `${name}: kein eigener Hintergrund.`);
  // Die Trennlinie ist FORM, nicht Farbe — Marco hat eine Rot-Gruen-Schwaeche.
  assert.match(kopf, /border-bottom:1px solid/, 'Der Titelleiste fehlt die Trennlinie.');
  assert.match(fuss, /border-top:1px solid/, 'Der Fussleiste fehlt die Trennlinie.');

  const modal = regel('.modal');
  for (const v of ['--modal-padx', '--modal-pady', '--modal-padb'])
    assert.ok(
      modal.includes(v + ':'),
      `.modal setzt ${v} nicht mehr. Die Leisten rechnen damit ihre negativen Raender; ` +
        `ohne die Variable faellt calc() aus und die Leisten sitzen falsch.`,
    );

  // ── 3. Die Handyfassung darf die Polsterung nicht zurueckdrehen ───────────
  const mobil = ohneCssKommentare(fs.readFileSync(path.join(__dirname, '..', 'public', 'mobile.css'), 'utf8'));
  assert.doesNotMatch(
    mobil,
    /\.mhd\s*\{[^}]*position:\s*sticky/,
    'mobile.css setzt .mhd wieder selbst auf sticky. Diese Regel gab es dort schon ' +
      'einmal — mit top:0 und eigener Polsterung, wodurch die Leiste zu tief stand. ' +
      'Die Regel steht jetzt in styles.css fuer alle Breiten.',
  );
  assert.match(
    mobil,
    /--modal-padx:/,
    'Die Handyfassung setzt ihre Polsterung nicht ueber die Variablen — dann sind die ' +
      'Leisten dort um die Differenz zu breit.',
  );
});
