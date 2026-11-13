'use strict';
/**
 * Kein Antwortfeld ohne Verbraucher.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { quellwurzeln } = require('../test/helpers/android');

/**
 * Schlüssel, die absichtlich kein Client liest. Jeder mit Grund — die Liste
 * darf nur KÜRZER werden.
 */
const ERLAUBT = new Map([
  // Diagnose-Endpunkte: für Betreiber und curl, nicht für die Oberfläche.
  ['body_check', 'Selbstprüfung /v1/admin'],
  ['datenbank', 'Selbstprüfung'],
  ['db_pool', 'Verbindungspool im Gesundheitsbericht'],
  ['probes', 'Selbstprüfung'],
  ['proxy_failures', 'Selbstprüfung'],
  ['merker', 'Selbstprüfung'],
  ['hinweis', 'Selbstprüfung'],
  ['rate_limit', 'nur noch im Admin-Bericht, nicht mehr in der Bewertung'],
  // Export-Datei: gelesen wird sie vom Import DIESES Servers, nicht von einem Client.
  ['tokens', 'Einstellungs-Export'],
  // Antworten, die der Browser als Ganzes weiterverarbeitet oder ignoriert.
  ['email_sent', 'Registrierung: Ablauf hängt nicht daran'],
  ['userId', 'Anmeldeantwort; die Oberfläche liest die Sitzung, nicht das Feld'],
  ['never_expires', 'API-Token-Verwaltung, nur Webapp-Formular'],
  ['token_expires', 'API-Token-Verwaltung'],
  ['token_last_used', 'API-Token-Verwaltung'],
  ['instruction', 'Einzelanleitung; die Liste kommt über instructions'],
  ['missingImages', 'PDF-Job: die Oberfläche zeigt etaSeconds, nicht die Zahl'],
]);

/** Technische Umschläge, die in fast jeder Antwort stehen. */
const RAHMEN = new Set(['success', 'error', 'message', 'ok', 'status', 'data', 'code', 'detail']);

/** @param {string} wurzel @param {string[]} endungen @param {string[]} aus */
function dateien(wurzel, endungen, aus) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const lauf = d => {
    let e;
    try {
      e = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
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

/**
 * Schlüssel der obersten Ebene aus allen res.json({…}) einer Quelle — und aus
 * `return { success: true, … }`: So geben die Dienste unter src/ die
 * Antwort zurück, die eine Route unverändert weiterreicht.
 */
/** @param {string} s @param {RegExp} [re] */
function antwortSchluessel(s, re = /res\.json\(\s*\{|return\s*\{(?=\s*success:\s*true)/g) {
  const gefunden = new Set();
  while (re.exec(s) !== null) {
    let tiefe = 1,
      i = re.lastIndex;
    while (i < s.length && tiefe > 0) {
      const c = s[i];
      if (c === '(' || c === '{' || c === '[') tiefe++;
      else if (c === ')' || c === '}' || c === ']') tiefe--;
      i++;
    }
    // Verschachteltes ausblenden — dort stehen fremde Objektformen.
    let ebene = 0;
    let oben = '';
    for (const c of s.slice(re.lastIndex, i - 1)) {
      if (c === '(' || c === '{' || c === '[') ebene++;
      else if (c === ')' || c === '}' || c === ']') ebene--;
      oben += ebene === 0 ? c : ' ';
    }
    for (const k of oben.matchAll(/(?:^|,)\s*([A-Za-z_]\w*)\s*:/g)) gefunden.add(k[1]);
  }
  return gefunden;
}

const quellen = dateien(ROOT, ['.ts'], ['node_modules', `${path.sep}dist`, `${path.sep}test`, `${path.sep}scripts`]);
if (quellen.length < 40) {
  console.error(
    `❌ Nur ${quellen.length} TypeScript-Quellen gefunden — Pfad veraltet? ` + 'Eine leere Suche wäre still grün.',
  );
  process.exit(1);
}

/** @type {Map<string, string[]>} */
const woher = new Map();
/** @type {[string, string][]} */
const texte = quellen.map(p => [path.relative(ROOT, p), fs.readFileSync(p, 'utf8')]);
// Routen antworten mit `{ success: true, ...(await dienst(…)) }`: Die Felder stehen im return des Dienstes.
const gespreizt = new Set(texte.flatMap(([, s]) => [...s.matchAll(/\.\.\.\(await (?:\w+\.)?(\w+)\(/g)].map(m => m[1])));
for (const [rel, s] of texte) {
  const rumpfe = [...s.matchAll(/function (\w+)\s*[(<]/g)]
    .filter(m => gespreizt.has(m[1]))
    .map(m => {
      let i = s.indexOf('{', s.indexOf(')', m.index));
      const anfang = i;
      for (let tiefe = 0; i < s.length; i++) {
        if (s[i] === '{') tiefe++;
        else if (s[i] === '}' && --tiefe === 0) break;
      }
      // Nur die return-Anweisungen des Rumpfs selbst, nicht innerer Funktionen.
      const rumpf = s.slice(anfang, i);
      let tiefe = 0,
        oben = '';
      for (let j = 0; j < rumpf.length; j++) {
        if (rumpf[j] === '{') tiefe++;
        else if (rumpf[j] === '}') tiefe--;
        oben += tiefe === 1 && rumpf.startsWith('return', j) ? '§' : rumpf[j];
      }
      return oben;
    });
  for (const k of [antwortSchluessel(s), ...rumpfe.map(r => antwortSchluessel(r, /§eturn\s*\{/g))].flatMap(m => [...m]))
    woher.set(k, (woher.get(k) || []).concat(rel));
}

const verbraucher = [
  ...dateien(path.join(ROOT, 'public'), ['.js', '.html'], ['app.bundle.js']),
  ...quellwurzeln().flatMap(w => dateien(w, ['.kt'], [])),
];
if (verbraucher.length < 50) {
  console.error(
    `❌ Nur ${verbraucher.length} Verbraucherdateien gefunden — ohne sie ` +
      'gälte JEDES Feld als ungelesen, und die Prüfung wäre wertlos.',
  );
  process.exit(1);
}
const kunde = verbraucher.map(p => fs.readFileSync(p, 'utf8')).join('\n');

const fehler = [];
for (const [k, dateienListe] of [...woher].sort()) {
  if (RAHMEN.has(k) || ERLAUBT.has(k)) continue;
  if (!new RegExp(`\\b${k}\\b`).test(kunde)) {
    fehler.push(`${k}  (${[...new Set(dateienListe)].slice(0, 2).join(', ')})`);
  }
}
// Eine Erlaubnis, die niemand mehr braucht, ist eine, die niemand mehr prüft.
const tot = [...ERLAUBT.keys()].filter(k => !woher.has(k));

if (fehler.length || tot.length) {
  console.error('❌ Antwortfelder:');
  for (const f of fehler) {
    console.error(
      `  OHNE VERBRAUCHER: ${f} — weder public/js noch die Android-App ` +
        'nennen den Namen. Entweder fehlt die Anzeige, oder das Feld (und die ' +
        'Rechnung dahinter) gehört aus der Antwort.',
    );
  }
  for (const t of tot) console.error(`  TOTE AUSNAHME: ${t} — gibt es in keiner Antwort mehr, Zeile streichen.`);
  process.exit(1);
}
console.log(
  `✅ Antwortfelder: ${woher.size} Schlüssel aus ${quellen.length} Quellen, ` +
    `${verbraucher.length} Verbraucherdateien, ${ERLAUBT.size} begründete Ausnahmen.`,
);
