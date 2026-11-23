'use strict';
/**
 * No response field without a consumer.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Keys that deliberately no client reads. Each with a reason — the list
 * may only get SHORTER.
 */
const ALLOWED = new Map([
  // Diagnostic endpoints: for operators and curl, not for the UI.
  ['body_check', 'Selbstprüfung /v1/admin'],
  ['database', 'Selbstprüfung'],
  ['db_pool', 'Verbindungspool im Gesundheitsbericht'],
  ['probes', 'Selbstprüfung'],
  ['proxy_failures', 'Selbstprüfung'],
  ['marker', 'Selbstprüfung'],
  ['hint', 'Selbstprüfung'],
  ['rate_limit', 'nur noch im Admin-Bericht, nicht mehr in der Bewertung'],
  // Export file: it is read by the import of THIS server, not by a client.
  ['tokens', 'Einstellungs-Export'],
  // Responses the browser processes or ignores as a whole.
  ['email_sent', 'Registrierung: Ablauf hängt nicht daran'],
  ['userId', 'Anmeldeantwort; die Oberfläche liest die Sitzung, nicht das Feld'],
  ['never_expires', 'API-Token-Verwaltung, nur Webapp-Formular'],
  ['token_expires', 'API-Token-Verwaltung'],
  ['token_last_used', 'API-Token-Verwaltung'],
  ['instruction', 'Einzelanleitung; die Liste kommt über instructions'],
  ['missingImages', 'PDF-Job: die Oberfläche zeigt etaSeconds, nicht die Zahl'],
  // Hidden until 14.11.2026, because the check counted every word in the Kotlin source as a reader.
  ['view', 'Haushaltsstand: die Clients lesen parents und sub_accounts'],
  ['deleted', 'Merkposten löschen: die Clients laden die Liste danach neu'],
]);

/** Technical envelopes that stand in almost every response. */
const FRAME = new Set(['success', 'error', 'message', 'ok', 'status', 'data', 'code', 'detail']);

/** @param {string} root @param {string[]} extensions @param {string[]} from */
function files(root, extensions, from) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const run = d => {
    let e;
    try {
      e = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const x of e) {
      const p = path.join(d, x.name);
      if (from.some(a => p.includes(a))) continue;
      if (x.isDirectory()) run(p);
      else if (extensions.some(s => x.name.endsWith(s))) out.push(p);
    }
  };
  run(root);
  return out;
}

const OPENS = new Set(['(', '{', '[']);
const CLOSES = new Set([')', '}', ']']);

/** Index behind the bracket that closes the one opened just before `start`. @param {string} s @param {number} start */
function closingIndex(s, start) {
  let depth = 1,
    i = start;
  while (i < s.length && depth > 0) {
    if (OPENS.has(s[i] ?? '')) depth++;
    else if (CLOSES.has(s[i] ?? '')) depth--;
    i++;
  }
  return i;
}

/** The text with everything nested blanked out: foreign object shapes stand there. @param {string} text */
function topLevel(text) {
  let layer = 0;
  let top = '';
  for (const c of text) {
    if (OPENS.has(c)) layer++;
    else if (CLOSES.has(c)) layer--;
    top += layer === 0 ? c : ' ';
  }
  return top;
}

/**
 * Top-level keys from all res.json({…}) of a source — and from
 * `return { success: true, … }`: that is how the services under src/ return the
 * response a route passes on unchanged.
 */
/** @param {string} s @param {RegExp} [re] */
function responseKey(s, re = /res\.json\(\s*\{|return\s*\{(?=\s*success:\s*true)/g) {
  const found = new Set();
  while (re.exec(s) !== null) {
    const i = closingIndex(s, re.lastIndex);
    const top = topLevel(s.slice(re.lastIndex, i - 1));
    for (const k of top.matchAll(/(?:^|,)\s*([A-Za-z_]\w*)\s*:/g)) found.add(k[1]);
  }
  return found;
}

const sources = files(ROOT, ['.ts'], ['node_modules', `${path.sep}dist`, `${path.sep}test`, `${path.sep}scripts`]);
if (sources.length < 40) {
  console.error(
    `❌ Nur ${sources.length} TypeScript-Quellen gefunden — Pfad veraltet? ` + 'Eine leere Suche wäre still grün.',
  );
  process.exit(1);
}

/** @type {Map<string, string[]>} */
const whence = new Map();
/** @type {[string, string][]} */
const texts = sources.map(p => [path.relative(ROOT, p), fs.readFileSync(p, 'utf8')]);
// Routes answer with `{ success: true, ...(await dienst(…)) }`: the fields are in the service's return.
const spread = new Set(texts.flatMap(([, s]) => [...s.matchAll(/\.\.\.\(await (?:\w+\.)*(\w+)\(/g)].map(m => m[1])));
for (const [rel, s] of texts) {
  const bodies = [...s.matchAll(/function (\w+)\s*[(<]/g)]
    .filter(m => spread.has(m[1]))
    .map(m => {
      let i = s.indexOf('{', s.indexOf(')', m.index));
      const start = i;
      for (let depth = 0; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}' && --depth === 0) break;
      }
      // Only the return statements of the body itself, not of inner functions.
      const body = s.slice(start, i);
      let depth = 0,
        top = '';
      for (let j = 0; j < body.length; j++) {
        if (body[j] === '{') depth++;
        else if (body[j] === '}') depth--;
        top += depth === 1 && body.startsWith('return', j) ? '§' : body[j];
      }
      return top;
    });
  // A route under routes/ returns the body; the contract router puts it into the envelope.
  // Helper functions stand before the first endpoint; counting starts from there.
  const ab = s.indexOf('.endpoint(');
  const own =
    rel.startsWith(`routes${path.sep}`) && ab >= 0
      ? new Set([...responseKey(s.slice(0, ab)), ...responseKey(s.slice(ab), /res\.json\(\s*\{|return\s*\{/g)])
      : responseKey(s);
  for (const k of [own, ...bodies.map(r => responseKey(r, /§eturn\s*\{/g))].flatMap(m => [...m]))
    whence.set(k, (whence.get(k) || []).concat(rel));
}

const consumer = files(path.join(ROOT, 'public'), ['.js', '.html'], ['app.bundle.js']);
if (consumer.length < 40) {
  console.error(
    `❌ Nur ${consumer.length} Verbraucherdateien gefunden — ohne sie ` +
      'gälte JEDES Feld als ungelesen, und die Prüfung wäre wertlos.',
  );
  process.exit(1);
}
// What the app reads is in shared/app-interface.json (generated from its models).
const appFields = JSON.parse(
  fs.readFileSync(path.join(ROOT, '..', 'shared', 'app-interface.json'), 'utf8'),
).response_fields;
if (!Array.isArray(appFields) || appFields.length < 100) {
  console.error('❌ shared/app-interface.json nennt kaum Antwortfelder der App — erzeugt?');
  process.exit(1);
}
const customer = [...consumer.map(p => fs.readFileSync(p, 'utf8')), ...appFields].join('\n');

const error = [];
for (const [k, filesList] of [...whence].sort()) {
  if (FRAME.has(k) || ALLOWED.has(k)) continue;
  if (!new RegExp(`\\b${k}\\b`).test(customer)) {
    error.push(`${k}  (${[...new Set(filesList)].slice(0, 2).join(', ')})`);
  }
}
// A permission nobody needs any more is one nobody checks any more.
const tot = [...ALLOWED.keys()].filter(k => !whence.has(k));

if (error.length || tot.length) {
  console.error('❌ Antwortfelder:');
  for (const f of error) {
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
  `✅ Antwortfelder: ${whence.size} Schlüssel aus ${sources.length} Quellen, ` +
    `${consumer.length} Verbraucherdateien, ${ALLOWED.size} begründete Ausnahmen.`,
);
