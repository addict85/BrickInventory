'use strict';
/**
 * Kein Antwortfeld ohne Verbraucher.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Schlüssel, die absichtlich kein Client liest. Jeder mit Grund — die Liste
 * darf nur KÜRZER werden.
 */
const ALLOWED = new Map([
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
  // Bis 14.11.2026 verdeckt, weil die Prüfung jedes Wort im Kotlin-Quelltext als Leser zählte.
  ['blickfeld', 'Haushaltsstand: die Clients lesen parents und sub_accounts'],
  ['geloescht', 'Merkposten löschen: die Clients laden die Liste danach neu'],
]);

/** Technische Umschläge, die in fast jeder Antwort stehen. */
const FRAME = new Set(['success', 'error', 'message', 'ok', 'status', 'data', 'code', 'detail']);

/** @param {string} wurzel @param {string[]} extensions @param {string[]} aus */
function dateien(wurzel, extensions, aus) {
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
      else if (extensions.some(s => x.name.endsWith(s))) out.push(p);
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
function responseKey(s, re = /res\.json\(\s*\{|return\s*\{(?=\s*success:\s*true)/g) {
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
    let layer = 0;
    let oben = '';
    for (const c of s.slice(re.lastIndex, i - 1)) {
      if (c === '(' || c === '{' || c === '[') layer++;
      else if (c === ')' || c === '}' || c === ']') layer--;
      oben += layer === 0 ? c : ' ';
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
const spread = new Set(texte.flatMap(([, s]) => [...s.matchAll(/\.\.\.\(await (?:\w+\.)*(\w+)\(/g)].map(m => m[1])));
for (const [rel, s] of texte) {
  const rumpfe = [...s.matchAll(/function (\w+)\s*[(<]/g)]
    .filter(m => spread.has(m[1]))
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
  // Eine Route unter routes/ gibt den Rumpf zurück; der Vertragsrouter setzt ihn in die Hülle.
  // Hilfsfunktionen stehen vor dem ersten Endpunkt; gezählt wird ab dort.
  const ab = s.indexOf('.endpunkt(');
  const eigen =
    rel.startsWith(`routes${path.sep}`) && ab >= 0
      ? new Set([...responseKey(s.slice(0, ab)), ...responseKey(s.slice(ab), /res\.json\(\s*\{|return\s*\{/g)])
      : responseKey(s);
  for (const k of [eigen, ...rumpfe.map(r => responseKey(r, /§eturn\s*\{/g))].flatMap(m => [...m]))
    woher.set(k, (woher.get(k) || []).concat(rel));
}

const consumer = dateien(path.join(ROOT, 'public'), ['.js', '.html'], ['app.bundle.js']);
if (consumer.length < 40) {
  console.error(
    `❌ Nur ${consumer.length} Verbraucherdateien gefunden — ohne sie ` +
      'gälte JEDES Feld als ungelesen, und die Prüfung wäre wertlos.',
  );
  process.exit(1);
}
// Was die App liest, steht in shared/app-schnittstelle.json (aus ihren Modellen erzeugt).
const appFields = JSON.parse(
  fs.readFileSync(path.join(ROOT, '..', 'shared', 'app-schnittstelle.json'), 'utf8'),
).antwortfelder;
if (!Array.isArray(appFields) || appFields.length < 100) {
  console.error('❌ shared/app-schnittstelle.json nennt kaum Antwortfelder der App — erzeugt?');
  process.exit(1);
}
const customer = [...consumer.map(p => fs.readFileSync(p, 'utf8')), ...appFields].join('\n');

const fehler = [];
for (const [k, filesList] of [...woher].sort()) {
  if (FRAME.has(k) || ALLOWED.has(k)) continue;
  if (!new RegExp(`\\b${k}\\b`).test(customer)) {
    fehler.push(`${k}  (${[...new Set(filesList)].slice(0, 2).join(', ')})`);
  }
}
// Eine Erlaubnis, die niemand mehr braucht, ist eine, die niemand mehr prüft.
const tot = [...ALLOWED.keys()].filter(k => !woher.has(k));

if (fehler.length || tot.length) {
  console.error('❌ Antwortfelder:');
  for (const f of fehler) {
    console.error(
      `  OHNE VERBRAUCHER: ${f} — weder public/js noch die Android-App ` +
        'nennen den Namen. Entweder fehlt die Anzeige, oder das Feld (und die ' +
        'Rechnung dahinter) gehört aus der Antwort.',
    );
  }
  for (const t of tot) console.error(`  TOTE EXCEPTION: ${t} — gibt es in keiner Antwort mehr, Zeile streichen.`);
  process.exit(1);
}
console.log(
  `✅ Antwortfelder: ${woher.size} Schlüssel aus ${quellen.length} Quellen, ` +
    `${consumer.length} Verbraucherdateien, ${ALLOWED.size} begründete Ausnahmen.`,
);
