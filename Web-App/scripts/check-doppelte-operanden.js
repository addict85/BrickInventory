'use strict';
/**
 * Derselbe Operand zweimal — der Tippfehler, der sich am besten versteckt.
 *
 * ── Woher diese Prüfung kommt ───────────────────────────────────────────────
 * In utils/financeCalc.ts stand dieselbe Verwechslung an drei Formen:
 *
 *   achtmal   if (parseFloat(x.avg_price) > 0 || parseFloat(x.avg_price) > 0)
 *   sechsmal  qty_avg_price: parseFloat(x.avg_price)
 *   zweimal   SELECT avg_price, avg_price FROM part_price_cache
 *
 * Gemeint war jedes Mal qty_avg_price. Die erste Form ist folgenlos — ein
 * doppelter Operand ändert am Ergebnis nichts —, und genau deshalb überlebt
 * sie: Nichts schlägt fehl, kein Test wird rot, der Compiler schweigt. Die
 * zweite und dritte Form liefern dagegen still den falschen WERT: Bei Teilen
 * und Minifiguren war qty_avg_price nie der mengengewichtete Schnitt, sondern
 * immer eine Kopie des einfachen.
 *
 * Alle drei stecken in Funktionen, die voneinander kopiert wurden. Das ist das
 * Muster: nicht falsch gedacht, sondern vervielfältigt — und beim Kopieren
 * verrutscht.
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────
 *   A) Derselbe Ausdruck beidseits von || oder && — auf JEDER Klammerebene.
 *   B) Dieselbe Spalte zweimal in einer SELECT-Liste.
 *
 * Beides über die Webapp UND die Android-App: Kotlin kennt denselben Fehler.
 *
 * ── Was beim Bauen dieser Prüfung schiefging (und hier steht, damit es nicht
 *    noch einmal passiert) ────────────────────────────────────────────────────
 * Die erste Fassung trennte nur auf oberster Klammerebene und fand den
 * bekannten Fehler nicht — er steht innerhalb von `if (…)`. Die zweite entfernte
 * Leerraum auch INNERHALB von Regex-Literalen und hielt daraufhin `/^  \S/` und
 * `/^\S/` für denselben Ausdruck. Eine Prüfung, die sich nicht zuerst am
 * bekannten Fall bewährt, meldet „nichts gefunden" und man glaubt ihr.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ANDROID = path.join(ROOT, '..', 'Android-App', 'app', 'src');

/** Stellen, an denen die Wiederholung Absicht ist. Jede mit Grund. */
const ERLAUBT = new Map([
  ['test/rate-limit.test.js:l.tryConsume()',
   'Der Aufruf ZÄHLT hoch — dreimal hintereinander ist genau der Punkt'],
]);

/** Leerraum entfernen, aber nicht in Zeichenketten oder Regex-Literalen. */
/** @param {string} t */
function knapp(t) {
  let out = '', grenze = null;
  for (let i = 0; i < t.length; i++) {
    // `const c = t[i]` waere unter noUncheckedIndexedAccess `string|undefined`.
    // charAt() gibt bei einem Index ausserhalb '' zurueck — hier unerreichbar,
    // aber der Typ sagt es, ohne dass ein `!` noetig wird.
    const c = t.charAt(i);
    if (grenze) {
      out += c;
      if (c === '\\' && i + 1 < t.length) { out += t[i + 1]; i++; }
      else if (c === grenze) grenze = null;
    } else if (c === '"' || c === "'" || c === '`' || c === '/') {
      grenze = c; out += c;
    } else if (!/\s/.test(c)) out += c;
  }
  return out;
}

/** Ausdruck links von Position i, klammerbalanciert. */
/** @param {string} s @param {number} i */
function links(s, i) {
  let j = i - 1, tiefe = 0;
  while (j >= 0) {
    const c = s[j];
    if (c === ')' || c === ']' || c === '}') tiefe++;
    else if (c === '(' || c === '[' || c === '{') { if (tiefe === 0) break; tiefe--; }
    else if (tiefe === 0 && (c === ',' || c === ';' ||
             s.slice(j, j + 2) === '||' || s.slice(j, j + 2) === '&&')) break;
    j--;
  }
  return s.slice(j + 1, i);
}

/** Ausdruck rechts von Position i. */
/** @param {string} s @param {number} i */
function rechts(s, i) {
  let j = i, tiefe = 0;
  while (j < s.length) {
    const c = s[j];
    if (c === '(' || c === '[' || c === '{') tiefe++;
    else if (c === ')' || c === ']' || c === '}') { if (tiefe === 0) break; tiefe--; }
    else if (tiefe === 0 && (c === ',' || c === ';' ||
             s.slice(j, j + 2) === '||' || s.slice(j, j + 2) === '&&')) break;
    j++;
  }
  return s.slice(i, j);
}

/** @param {string} wurzel @param {string[]} endungen @param {string[]} aus */
function dateien(wurzel, endungen, aus) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const lauf = (d) => {
    let e;
    try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of e) {
      const p = path.join(d, x.name);
      if (aus.some(a => p.includes(a))) continue;
      if (x.isDirectory()) lauf(p);
      else if (endungen.some(s => x.name.endsWith(s))) out.push(p);
    }
  };
  lauf(wurzel);
  return out;
}

const quellen = [
  ...dateien(ROOT, ['.ts', '.js'], ['node_modules', `${path.sep}dist`, 'app.bundle', 'vendor', '.d.ts']),
  ...dateien(ANDROID, ['.kt'], [`${path.sep}build`]),
];
if (quellen.length < 300) {
  console.error(`❌ Nur ${quellen.length} Quelldateien gefunden — Pfad veraltet? ` +
    'Eine leere Suche wäre still grün, und genau davor warnt der Kopf dieser Datei.');
  process.exit(1);
}

const fehler = [];
let geprueft = 0;
for (const p of quellen) {
  const rel = path.relative(path.join(ROOT, '..'), p);
  const zeilen = fs.readFileSync(p, 'utf8').split('\n');
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i] ?? '';
    const t = z.trim();
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;

    // A) derselbe Operand beidseits von || bzw. &&
    for (const m of z.matchAll(/\|\||&&/g)) {
      geprueft++;
      const l = knapp(links(z, m.index));
      const r = knapp(rechts(z, m.index + 2));
      if (l.length >= 8 && l === r) {
        const kurz = `${path.relative(ROOT, p)}:${l}`;
        if (!ERLAUBT.has(kurz)) fehler.push(`${rel}:${i + 1}  ${l} ${m[0]} ${l}`);
        break;
      }
    }

    // B) dieselbe Spalte zweimal in einer SELECT-Liste
    const sel = z.match(/SELECT\s+([A-Za-z_][\w\s,.]{4,200}?)\s+FROM\b/i);
    if (sel) {
      geprueft++;
      const sp = (sel[1] ?? '').split(',')
        .map(x => (x.trim().split(/\s+/).pop() ?? '').split('.').pop() ?? '')
        .filter(x => x !== '');
      const doppelt = sp.filter((x, k) => sp.indexOf(x) !== k);
      if (doppelt.length) fehler.push(`${rel}:${i + 1}  SELECT … ${doppelt.join(', ')} zweimal`);
    }
  }
}

if (fehler.length) {
  console.error('❌ Doppelte Operanden:');
  for (const f of fehler) {
    console.error(`  ${f}\n     Derselbe Ausdruck zweimal ist entweder folgenlos — dann ist er ` +
      'irreführend — oder es war ein anderer gemeint. Beides gehört angesehen.');
  }
  process.exit(1);
}
console.log(`✅ Doppelte Operanden: ${quellen.length} Dateien, ${geprueft} Stellen geprüft, ` +
  `${ERLAUBT.size} begründete Ausnahme(n).`);
