/**
 * Jeder Schlüssel, den die Oberfläche ruft, steht auch im Wörterbuch.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * `t()` fällt für einen unbekannten Schlüssel auf den SCHLÜSSEL SELBST zurück
 * (public/i18n.js: `dict[key] || I18N['de']?.[key] || key`). Das ist als
 * letzte Stufe richtig — sichtbar wird es aber sofort:
 *
 * NACHGEMESSEN trugen NEUN Auswahlfelder in index.html ein `data-i18n` mit
 * `data-i18n-attr="aria-label"` auf einen Schlüssel, den es in KEINER der
 * beiden Sprachdateien gab — Jahr von/bis im Katalog, Sortierung und
 * Themenfilter in Galerie und Katalog, Farbe, Ersatzteile und Ansicht bei den
 * Teilen, die CSV-Auswahl, Registrierung und SMTP-Verschlüsselung in den
 * Einstellungen.
 *
 * Im HTML stand jeweils ein deutsches `aria-label` als Vorgabe. `applyLang()`
 * läuft aber bei JEDEM Seitenaufbau über alle `[data-i18n]` und ÜBERSCHREIBT
 * das Attribut mit dem Ergebnis von `t()` — also mit dem rohen Schlüssel. Ein
 * Bildschirmleser las danach „catalog.year_from" vor, in beiden Sprachen. Wer
 * die Oberfläche sieht, merkt davon nichts; das ist der Grund, warum es so
 * lange stehen konnte.
 *
 * ── Warum die bestehenden i18n-Tests das nicht fanden ───────────────────────
 *
 * i18n.test.js vergleicht DE und EN miteinander, i18n-duplicates.test.js sucht
 * doppelte Schlüssel. Beide sehen nur die Wörterbücher. Ein Schlüssel, der in
 * BEIDEN fehlt, ist für sie in Ordnung — die Frage „ruft ihn überhaupt jemand,
 * und gibt es ihn dann auch?" hat niemand gestellt.
 *
 * ── Die eine Ausnahme, und warum sie eine ist ───────────────────────────────
 *
 * 01-core.js baut einen Schlüssel zusammen: `t('monitor.job.' + k)`. Der
 * Aufruf prüft das Ergebnis SELBST gegen den Schlüssel und fällt auf die
 * Beschriftung des Servers zurück, wenn nichts da ist. Solche Präfixe enden
 * auf einen Punkt und werden hier übersprungen — mit einer Zusicherung auf
 * ihre Anzahl, damit ein zweiter Fall auffällt statt sich anzuschliessen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadTranslations } = require('./helpers/sources');
const ROOT = path.join(__dirname, '..');

/** Alle Quelldateien der Oberfläche — ohne Kommentare, ohne das Bündel. */
function oberflaeche() {
  const out = [];
  const lauf = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      // locales/ selbst enthaelt die Schluessel als Definition, nicht als Aufruf.
      if (e.isDirectory()) { if (!/node_modules|locales/.test(p)) lauf(p); continue; }
      if (!/\.(js|html)$/.test(e.name) || e.name === 'app.bundle.js') continue;
      // Kommentare ZUERST weg: i18n.js dokumentiert die eigene Nutzung mit
      // `t('key')` in einem Kommentar. Ohne diesen Schritt zaehlt der
      // Beispielaufruf als echte Fundstelle — genau die Falle, vor der
      // test/helpers/sources.js warnt.
      out.push([path.relative(ROOT, p),
        fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]);
    }
  };
  lauf(path.join(ROOT, 'public'));
  return out;
}

const RUF = /\bt(?:Raw)?\(\s*'([a-z0-9_.]+)'|\bt(?:Raw)?\(\s*"([a-z0-9_.]+)"|data-i18n(?:-tab)?="([a-z0-9_.]+)"/g;

test('jeder gerufene i18n-Schlüssel steht im Wörterbuch', () => {
  const { de, en } = loadTranslations();
  const vorhanden = new Set([...Object.keys(de), ...Object.keys(en)]);
  assert.ok(vorhanden.size >= 400,
    `Nur ${vorhanden.size} Schlüssel geladen — Pfad oder Format veraltet?`);

  const dateien = oberflaeche();
  assert.ok(dateien.length >= 15, `Nur ${dateien.length} Quelldateien gefunden`);

  const gerufen = new Map();
  for (const [rel, src] of dateien)
    for (const m of src.matchAll(RUF)) {
      const k = m[1] || m[2] || m[3];
      if (!gerufen.has(k)) gerufen.set(k, rel);
    }
  // Selbstbeweis: Greift das Muster nicht mehr, wäre die Menge leer und der
  // Test grün, ohne etwas geprüft zu haben. GEMESSEN sind es 542.
  assert.ok(gerufen.size >= 300,
    `Nur ${gerufen.size} Aufrufstellen gefunden — Muster veraltet?`);

  // Zusammengesetzte Schlüssel (`t('monitor.job.' + k)`) enden auf einen Punkt.
  const praefixe = [...gerufen.keys()].filter(k => k.endsWith('.'));
  assert.equal(praefixe.length, 1,
    `${praefixe.length} zusammengesetzte Schlüssel (${praefixe.join(', ')}) — erwartet ` +
    'wird genau einer (monitor.job.). Ein zweiter braucht dieselbe eigene ' +
    'Absicherung wie er: Das Ergebnis gegen den Schlüssel prüfen und auf etwas ' +
    'anderes zurückfallen.');

  const fehlend = [...gerufen]
    .filter(([k]) => !k.endsWith('.') && !vorhanden.has(k))
    .map(([k, rel]) => `${k}   (${rel})`)
    .sort();
  assert.deepEqual(fehlend, [],
    'Diese Schlüssel ruft die Oberfläche, aber es gibt sie nicht:\n  ' +
    fehlend.join('\n  ') +
    '\nt() gibt dann den Schlüssel selbst aus — im Text sichtbar, im aria-label ' +
    'liest ihn der Bildschirmleser vor.');
});

/**
 * ── Und die Form des Aufrufs? ───────────────────────────────────────────────
 *
 * Die Prüfung oben fragt, ob es den SCHLÜSSEL gibt. Sie kann nicht fragen, ob
 * ihn überhaupt jemand liest — und genau daran lag ein zweiter Fall derselben
 * Sorte:
 *
 *     <div … data-i18n-before="finance.market_label">Ø Marktpreis: <span …>
 *
 * `applyLang()` kennt vier Formen (data-i18n, -attr, -vars, -tab). `-before`
 * ist keine davon; das Attribut stand da und tat nichts. Die Beschriftung des
 * Portfolio-Diagramms blieb deshalb in JEDER Sprache deutsch — und der
 * Schlüssel lag als „nie gerufen" im Wörterbuch, was ihn wie Ballast aussehen
 * liess statt wie eine Lücke.
 *
 * Warum jemand ihn erfunden hat, ist am Markup ablesbar: Der Text steht neben
 * einem <span>, und `textContent` würde den span mitsamt Wert überschreiben.
 * Die Lösung braucht dafür keine fünfte Form — der Text bekommt seinen eigenen
 * <span data-i18n="…">, und die vorhandene Mechanik greift.
 *
 * Die erlaubten Formen werden aus i18n.js GELESEN, nicht abgeschrieben: Eine
 * Liste, die eine Verdrahtung abschreibt, prüft die Verdrahtung nicht (siehe
 * test/helpers/sources.js, routerEinhaengungen).
 */
test('jede data-i18n-Form wird von applyLang auch ausgewertet', () => {
  const i18n = fs.readFileSync(path.join(ROOT, 'public', 'i18n.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // dataset.i18nAttr → data-i18n-attr; dataset.i18n → data-i18n.
  const erlaubt = new Set([...i18n.matchAll(/\bdataset\.(i18n[A-Za-z]*)/g)]
    .map(m => 'data-' + m[1].replace(/[A-Z]/g, c => '-' + c.toLowerCase())));
  assert.ok(erlaubt.size >= 3,
    `Nur ${erlaubt.size} Formen in i18n.js gefunden (${[...erlaubt].join(', ')}) — Muster veraltet?`);

  const benutzt = new Map();
  for (const [rel, src] of oberflaeche())
    for (const m of src.matchAll(/\b(data-i18n[a-z-]*)\s*=/g))
      if (!benutzt.has(m[1])) benutzt.set(m[1], rel);
  // GEMESSEN sind es vier Formen, 386 Vorkommen.
  assert.ok(benutzt.size >= 2, `Nur ${benutzt.size} data-i18n-Formen im Markup gefunden`);

  const wirkungslos = [...benutzt]
    .filter(([f]) => !erlaubt.has(f))
    .map(([f, rel]) => `${f}   (${rel})`)
    .sort();
  assert.deepEqual(wirkungslos, [],
    'Diese data-i18n-Formen wertet applyLang() nicht aus:\n  ' + wirkungslos.join('\n  ') +
    `\nAusgewertet werden nur: ${[...erlaubt].sort().join(', ')}. Ein Attribut, das ` +
    'keine davon ist, sieht nach Übersetzung aus und lässt den Text stehen, wie er ' +
    'im Quelltext steht — in jeder Sprache.');
});
