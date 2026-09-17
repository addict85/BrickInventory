const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..');

/**
 * Kopfleiste und Reiterleiste haften GEMEINSAM — oder gar nicht.
 *
 * ── Der Fehler, gegen den diese Pruefung gebaut ist ─────────────────────────
 *
 * styles.css heftet die Kopfleiste mit `position:sticky;top:0` an den oberen
 * Rand und die Reiterleiste darunter mit `position:sticky;top:58px`. Die 58
 * sind keine freie Zahl: Es ist die Hoehe der Kopfleiste. Die beiden Leisten
 * sind ueber diese eine Zahl aneinander gebunden.
 *
 * themes/noppe.css hat der Kopfleiste `position:relative` gegeben — nicht aus
 * gestalterischen Gruenden, sondern weil die Noppenreihe ein ::before mit
 * `position:absolute` ist und dafuer einen positionierten Vorfahren braucht.
 * Damit war die Kopfleiste nicht mehr angeheftet: Sie scrollte weg, die
 * Reiterleiste blieb auf 58px stehen und schob sich ueber den Inhalt. Marco
 * hat genau das gemeldet.
 *
 * Das `relative` war dabei nicht einmal noetig — `sticky` ist selbst ein
 * positionierter Vorfahre.
 *
 * ── Warum die Regel PAARWEISE ist und nicht „nie anfassen" ──────────────────
 *
 * Die erste Fassung dieser Pruefung verbot jedes `position` an einer
 * angehefteten Leiste. Sie war sofort rot — und zwar zu Recht ROT AN DER
 * FALSCHEN STELLE: themes/brick.css setzt Kopf- UND Reiterleiste auf
 * `position:static`, weil dort beide als mitscrollende Kacheln gedacht sind.
 * Das ist eine Gestaltungsentscheidung und kein Versehen; es geht auch nichts
 * kaputt, weil eben BEIDE mitscrollen.
 *
 * Kaputt geht genau der gemischte Fall: eine Leiste haftet, die andere nicht.
 * Das ist die Regel, die hier steht.
 */

/**
 * Kommentare weg, bevor irgendetwas zerlegt wird.
 *
 * Nicht kosmetisch: Ohne diesen Schritt haengt der Kommentarblock VOR einer
 * Regel am ersten Selektor, und aus `[data-theme="noppe"] header` wird
 * `/* … *\/\n[data-theme="noppe"] header`. Die Gegenprobe zu dieser Datei hat
 * genau das gezeigt — sie meldete nur den ZWEITEN der beiden Selektoren einer
 * Regel. Eine Verletzung in einer einselektorigen Regel mit Kommentar darueber
 * waere still durchgerutscht.
 */
const ohneKommentare = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Regeln als (Selektorliste, Rumpf) — einmal fuer alle Suchen hier. */
function regeln(css) {
  const raus = [];
  for (const stueck of ohneKommentare(css).split('}')) {
    const auf = stueck.indexOf('{');
    if (auf < 0) continue;
    raus.push([stueck.slice(0, auf).split(',').map(s => s.trim()), stueck.slice(auf + 1)]);
  }
  return raus;
}

/**
 * Was gilt am Ende fuer `sel` in diesem Design? Die letzte Regel gewinnt —
 * alle hier betrachteten Selektoren haben dieselbe Spezifitaet.
 */
function haftung(css, sel) {
  let wert = null;
  for (const [sels, rumpf] of regeln(css)) {
    if (!sels.some(s => s.replace(/^\[data-theme="[\w-]+"\]\s*/, '') === sel)) continue;
    const t = rumpf.match(/(?:^|[;\s])position\s*:\s*([\w-]+)/);
    if (t) wert = t[1];
  }
  return wert;
}

function designDateien() {
  const ordner = path.join(WEB, 'public', 'themes');
  return fs.readdirSync(ordner)
    .filter(n => n.endsWith('.css'))
    .map(n => [n, fs.readFileSync(path.join(ordner, n), 'utf8')]);
}

test('Kopf- und Reiterleiste haften in jedem Design gemeinsam', () => {
  const grund = fs.readFileSync(path.join(WEB, 'public', 'styles.css'), 'utf8');
  const grundKopf = haftung(grund, 'header');
  const grundReiter = haftung(grund, 'nav');
  // Selbstbeweis: Greift die Suche ueberhaupt? GEMESSEN steht in styles.css
  // an beiden `position:sticky`. Faende sie nichts, waere der Vergleich
  // darunter ein Vergleich von null mit null — und fuer immer still gruen.
  assert.equal(grundKopf, 'sticky', 'Die Kopfleiste ist in styles.css nicht mehr angeheftet');
  assert.equal(grundReiter, 'sticky', 'Die Reiterleiste ist in styles.css nicht mehr angeheftet');

  const dateien = designDateien();
  assert.ok(dateien.length >= 4, `Nur ${dateien.length} Design-Dateien — greift die Suche noch?`);

  const gemischt = [];
  for (const [name, css] of dateien) {
    const kopf = haftung(css, 'header') || grundKopf;
    const reiter = haftung(css, 'nav') || grundReiter;
    const haftetKopf = kopf === 'sticky' || kopf === 'fixed';
    const haftetReiter = reiter === 'sticky' || reiter === 'fixed';
    if (haftetKopf !== haftetReiter) {
      gemischt.push(`${name}: Kopfleiste "${kopf}", Reiterleiste "${reiter}"`);
    }
  }
  assert.deepEqual(gemischt, [],
    'Eine Leiste haftet, die andere nicht. Die Reiterleiste steht auf der HOEHE ' +
    'der Kopfleiste (top:58px); scrollt die Kopfleiste weg, bleibt die ' +
    'Reiterleiste dort stehen und schiebt sich ueber den Inhalt. Fuer ein ' +
    '::before braucht es kein `position:relative` — `sticky` ist selbst ein ' +
    'positionierter Vorfahre.');
});

test('die Reiterleiste sitzt auf der Hoehe der Kopfleiste', () => {
  // Die zweite Haelfte derselben Sache: Die 58px in `nav{top:58px}` sind KEINE
  // freie Zahl, sondern die Hoehe der Kopfleiste. Laufen die beiden
  // auseinander, klafft eine Luecke oder die Leisten ueberdecken sich — und im
  // Quelltext sieht beides richtig aus.
  const css = fs.readFileSync(path.join(WEB, 'public', 'styles.css'), 'utf8');
  const hoehe = css.match(/header\{[^}]*height:(\d+)px/);
  const versatz = css.match(/nav\{[^}]*top:(\d+)px/);
  assert.ok(hoehe && versatz, 'Kopf- oder Reiterleiste nicht mehr zu finden — greift die Suche noch?');
  assert.equal(versatz[1], hoehe[1],
    `Die Reiterleiste haftet bei ${versatz[1]}px, die Kopfleiste ist ${hoehe[1]}px hoch.`);
});
