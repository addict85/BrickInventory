#!/usr/bin/env node
/**
 * Erzeugt aus shared/design-tokens.json die Design-Dateien BEIDER Oberflaechen.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────
 * Das Web liest CSS-Custom-Properties, die App braucht Compose-Farben.
 * Derselbe Wert, zwei Sprachen — bisher stand er zweimal da und wurde von Hand
 * gleichgehalten. Jetzt steht er einmal, und beide Seiten werden daraus
 * erzeugt.
 *
 * Aufruf: node scripts/generate-design-tokens.js
 *         (laeuft auch als Teil von `npm run build`)
 *
 * Geprueft wird das Ergebnis von test/design-abschrift.test.js: Weicht eine
 * erzeugte Datei von der Quelle ab, wird der Lauf rot. Deshalb macht es nichts,
 * dass die Erzeugnisse mit im Baum liegen — sie muessen es sogar, weil der
 * Android-Build kein Node kennt.
 */
const fs = require('fs');
const path = require('path');

const WURZEL = path.join(__dirname, '..', '..');
const QUELLE = path.join(WURZEL, 'shared', 'design-tokens.json');
const ZIEL_CSS = path.join(WURZEL, 'Web-App', 'public', 'tokens.css');
const ZIEL_KT = path.join(WURZEL, 'Android-App', 'app', 'src', 'main', 'java',
  'ch', 'brickinventoryapp', 'ui', 'theme', 'DesignTokens.kt');

const HINWEIS = 'ERZEUGT aus shared/design-tokens.json — NICHT von Hand aendern.';

/**
 * Text auf Zeilen umbrechen.
 *
 * Wortweise, nicht per Regex: Die erste Fassung benutzte
 * `/(.{1,68})(\s|$)/g` und verschluckte dabei Woerter — im KDoc stand
 * "Der Grund ist nicht" und danach gleich "die Legende nicht lesen".
 * Ein Umbruch, der Text verliert, ist schlimmer als keiner.
 */
/** @param {string} text @param {number} [breite] @returns {string[]} */
function umbruch(text, breite = 72) {
  const zeilen = [];
  let z = '';
  for (const wort of text.split(/\s+/)) {
    if ((z + ' ' + wort).trim().length > breite) { zeilen.push(z.trim()); z = wort; }
    else z += ' ' + wort;
  }
  if (z.trim()) zeilen.push(z.trim());
  return zeilen;
}

/**
 * Aus den Token-Tabellen die CSS-Datei bauen.
 * @param {any} daten Inhalt von shared/design-tokens.json
 * @returns {string}
 */
function baueCss(daten) {
  // Die Begruendung reist MIT dem Wert. Sie stand vorher als Kommentar neben
  // der Zeile in styles.css bzw. themes/brick.css; zoege sie beim Umzug nicht
  // mit, waere nach zwei Jahren nicht mehr nachvollziehbar, warum die
  // Gebraucht-Linie Sand ist und nicht blau.
  /** @param {string} wahl @param {Record<string,string>} tokens */
  const block = (wahl, tokens) => {
    const zeilen = Object.entries(tokens).flatMap(([name, wert]) => {
      const notiz = (daten._notizen || {})[name];
      // Nur die ERSTE Zeile oeffnet den Kommentar, nur die letzte schliesst
      // ihn. CSS-Kommentare schachteln nicht: Ein `/*` auf jeder Zeile waere
      // zwar zufaellig gueltig (alles bis zum ersten `*/` gehoert dazu), laese
      // sich aber falsch und zerbraeche, sobald jemand eine Zeile umstellt.
      const vor = notiz
        ? ['', ...umbruch(notiz).map((z, i, a) =>
            `  ${i === 0 ? '/* ' : '   '}${z}${i === a.length - 1 ? ' */' : ''}`)]
        : [];
      return [...vor, `  --${name}: ${wert};`];
    }).join('\n');
    return `${wahl} {\n${zeilen}\n}`;
  };
  const teile = [];
  for (const [design, tokens] of Object.entries(daten.designs)) {
    // Das Grunddesign gilt immer, ein benanntes Design nur bei gesetztem
    // data-theme. Dessen hoehere Spezifitaet gewinnt gegen :root — die
    // Reihenfolge in der Datei spielt daher keine Rolle.
    teile.push(block(design === 'classic' ? ':root' : `[data-theme="${design}"]`, tokens));
  }
  return `/* ${HINWEIS}\n\n   ${daten._warum} */\n\n${teile.join('\n\n')}\n`;
}

/**
 * Aus der App-Zuordnung die Kotlin-Datei bauen.
 * @param {any} daten Inhalt von shared/design-tokens.json
 * @returns {string}
 */
function baueKotlin(daten) {
  const zeilen = Object.entries(daten.app).map(([name, { design, token }]) => {
    const wert = daten.designs[design][token];
    if (!wert) throw new Error(`design-tokens.json: --${token} gibt es im Design "${design}" nicht`);
    const hex = wert.replace('#', '').toUpperCase();
    const notiz = (daten._notizen || {})[token];
    const kdoc = notiz
      ? ['/**', ` * --${token} im Design "${design}".`, ' *',
         ...umbruch(notiz, 68).map(z => ` * ${z}`), ' */'].join('\n')
      : `/** --${token} im Design "${design}". */`;
    return `${kdoc}\nval ${name} = Color(0xFF${hex})`;
  });
  return `package ch.brickinventoryapp.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * ${HINWEIS}
 *
 * ${daten._app_warum}
 *
 * Erzeugt von Web-App/scripts/generate-design-tokens.js. Wer hier einen Wert
 * aendert, aendert ihn nur in der App — und genau das soll diese Datei
 * verhindern. Der Wert gehoert nach shared/design-tokens.json.
 */

${zeilen.join('\n\n')}
`;
}

// Erst beim Aufruf rechnen, nicht beim Laden: Die Pruefung importiert dieses
// Modul nur, um baueCss()/baueKotlin() selbst anzuwenden — sie braucht das
// Ergebnis nicht schon beim require.
if (require.main === module) {
  const daten = JSON.parse(fs.readFileSync(QUELLE, 'utf8'));
  /** @type {{datei: string, inhalt: string}[]} */
  const ausgaben = [
    { datei: ZIEL_CSS, inhalt: baueCss(daten) },
    { datei: ZIEL_KT, inhalt: baueKotlin(daten) },
  ];
  for (const { datei, inhalt } of ausgaben) {
    fs.writeFileSync(datei, inhalt);
    console.log(`[design-tokens] ${path.relative(WURZEL, datei)}`);
  }
}

// Fuer die Pruefung: dieselbe Rechnung, ohne zu schreiben.
module.exports = { baueCss, baueKotlin, QUELLE, ZIEL_CSS, ZIEL_KT };
