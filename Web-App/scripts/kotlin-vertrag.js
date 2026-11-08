'use strict';
/**
 * Die Android-App, gelesen aus ihrem eigenen Quelltext: die
 * @Serializable-Datenklassen und die Routen aus data/api/ (je Bereich eine
 * Datei). Der Vertrag selbst steht im Server (src/vertrag/);
 * vergleiche() prüft, ob die Modelle der App ihn lesen können.
 */
const fs = require('fs');
const path = require('path');

/**
 * @typedef {{ art: string, nullbar: boolean, element?: KTyp, wert?: KTyp, name?: string }} KTyp
 * @typedef {{ json: string, typ: KTyp, hatDefault: boolean }} KFeld
 * @typedef {Map<string, { datei: string, felder: KFeld[] }>} KModelle
 */

/** @type {Record<string, string>} */
const PRIMITIV = {
  String: 'string', Int: 'int', Long: 'int', Short: 'int',
  Double: 'number', Float: 'number', Boolean: 'boolean',
};

/** Alle .kt-Dateien unter `dir`. @param {string} dir @returns {string[]} */
function kotlinDateien(dir) {
  /** @type {string[]} */
  const aus = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) aus.push(...kotlinDateien(p));
    else if (e.name.endsWith('.kt')) aus.push(p);
  }
  return aus;
}

/**
 * Der Quelltext der App-Schnittstelle: eine Datei oder alle .kt eines Ordners —
 * die App führt je Bereich eine Datei (data/api/), geprüft wird die Summe.
 * @param {string} pfad @returns {string}
 */
function apiQuelltext(pfad) {
  if (!fs.statSync(pfad).isDirectory()) return fs.readFileSync(pfad, 'utf8');
  return kotlinDateien(pfad).sort().map(d => fs.readFileSync(d, 'utf8')).join('\n');
}

/** Kommentare und Zeichenketten so leeren, dass Positionen gleich bleiben. @param {string} src */
function entschaerfe(src) {
  let aus = '', i = 0;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { aus += ' '; i++; } continue; }
    if (c === '/' && n === '*') {
      const e = src.indexOf('*/', i + 2); const bis = e < 0 ? src.length : e + 2;
      for (; i < bis; i++) aus += src[i] === '\n' ? '\n' : ' ';
      continue;
    }
    if (c === '"') {
      // Zeichenketten bleiben stehen (SerialName braucht sie), nur ihr Inhalt
      // darf keine Klammern zählen lassen.
      let j = i + 1;
      while (j < src.length && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
      aus += src.slice(i, j + 1).replace(/[(){}<>,]/g, ' ');
      i = j + 1; continue;
    }
    aus += c; i++;
  }
  return aus;
}

/**
 * Bis zur passenden schliessenden Klammer; `i` steht auf der öffnenden.
 * @param {string} src @param {number} i @returns {number}
 */
function bisZu(src, i, auf = '(', zu = ')') {
  let tiefe = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === auf) tiefe++;
    else if (src[j] === zu && --tiefe === 0) return j;
  }
  return -1;
}

/** An Kommas auf oberster Ebene trennen (nicht in (), <>, []). @param {string} s */
function trenne(s) {
  /** @type {string[]} */
  const teile = []; let tiefe = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? '';
    if ('(<['.includes(c)) tiefe++;
    else if (')>]'.includes(c)) tiefe--;
    else if (c === ',' && tiefe === 0) { teile.push(s.slice(start, i)); start = i + 1; }
  }
  teile.push(s.slice(start));
  return teile.map(t => t.trim()).filter(Boolean);
}

/** Ein Typ als { art, nullbar, ... }. @param {string} roh @returns {KTyp} */
function typ(roh) {
  let t = roh.replace(/\s+/g, '');
  const nullbar = t.endsWith('?');
  if (nullbar) t = t.slice(0, -1);
  const g = /^([\w.]+)<(.*)>$/.exec(t);
  const name = ((g ? g[1] : t) ?? t).split('.').pop() ?? t;
  if (g && (name === 'List' || name === 'Set' || name === 'Array'))
    return { art: 'liste', nullbar, element: typ(g[2] ?? 'Any') };
  if (g && name === 'Map') return { art: 'karte', nullbar, wert: typ(trenne(g[2] ?? '')[1] || 'Any') };
  if (PRIMITIV[name]) return { art: PRIMITIV[name], nullbar };
  return { art: 'klasse', name, nullbar };
}

/** Alle @Serializable-Klassen: Name → Felder. @param {string | string[]} wurzel @returns {KModelle} */
function kotlinModelle(wurzel) {
  /** @type {KModelle} */
  const modelle = new Map();
  // Eine Wurzel oder mehrere: Seit der Aufteilung der App liegen die Modelle in
  // core-model, einige in core-data und app.
  for (const datei of (Array.isArray(wurzel) ? wurzel : [wurzel]).flatMap((w) => kotlinDateien(w))) {
    const roh = fs.readFileSync(datei, 'utf8');
    const src = entschaerfe(roh);
    for (const m of src.matchAll(/@Serializable\s+(?:data\s+)?class\s+(\w+)\s*\(/g)) {
      const auf = m.index + m[0].length - 1;
      const zu = bisZu(src, auf);
      if (zu < 0) continue;
      /** @type {KFeld[]} */
      const felder = [];
      for (const p of trenne(roh.slice(auf + 1, zu).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''))) {
        const sn = /@SerialName\(\s*"([^"]+)"\s*\)/.exec(p);
        const v = /\b(?:val|var)\s+(\w+)\s*:\s*([^=]+?)\s*(=|$)/s.exec(p.replace(/@\w+(\([^)]*\))?/g, ' '));
        if (!v) continue;
        felder.push({ json: (sn ? sn[1] : v[1]) ?? '', typ: typ(v[2] ?? 'Any'), hatDefault: v[3] === '=' });
      }
      modelle.set(m[1] ?? '', { datei: path.basename(datei), felder });
    }
  }
  return modelle;
}

/**
 * Die GET-Routen der App: Pfad und Antworttyp.
 * @param {string} serviceDatei
 * @returns {{ pfad: string, typ: string | null, anfrage: { name: string, pflicht: boolean }[] }[]}
 */
function apiRouten(serviceDatei) {
  const roh = apiQuelltext(serviceDatei);
  const src = entschaerfe(roh);
  /** @type {{ pfad: string, typ: string | null, anfrage: { name: string, pflicht: boolean }[] }[]} */
  const aus = [];
  for (const m of roh.matchAll(/@GET\("([^"]+)"\)/g)) {
    const fn = src.indexOf('suspend fun', m.index);
    const auf = src.indexOf('(', fn);
    const zu = bisZu(src, auf);
    const rest = roh.slice(zu + 1, zu + 200);
    const r = /^\s*:\s*Response<\s*([\w.]+)\s*>/.exec(rest);
    const name = r ? (r[1] ?? '').split('.').pop() ?? null : null;
    const params = roh.slice(auf + 1, zu);
    aus.push({ pfad: '/' + m[1], typ: name,
               anfrage: [...params.matchAll(/@Query\("([^"]+)"\)\s*\w+\s*:\s*([\w?]+)(\s*=)?/g)]
                 .map(q => ({ name: q[1] ?? '', pflicht: !(q[2] ?? '').endsWith('?') && !q[3] })) });
  }
  return aus;
}

/**
 * Die schreibenden Routen der App: Methode, Pfad, Antworttyp, Abfrage und der
 * Typ des Rumpfs (@Body), wenn er eine Klasse ist.
 * @param {string} serviceDatei
 * @returns {{ methode: string, pfad: string, typ: string | null, anfrage: { name: string }[], rumpf: string | null }[]}
 */
function schreibRouten(serviceDatei) {
  const roh = apiQuelltext(serviceDatei);
  const src = entschaerfe(roh);
  /** @type {{ methode: string, pfad: string, typ: string | null, anfrage: { name: string }[], rumpf: string | null }[]} */
  const aus = [];
  for (const m of roh.matchAll(/@(POST|PUT|DELETE|PATCH|HTTP)\((?:method\s*=\s*)?"([^"]+)"(?:,\s*path\s*=\s*"([^"]+)")?[^)]*\)/g)) {
    const fn = src.indexOf('suspend fun', m.index);
    const auf = src.indexOf('(', fn);
    const zu = bisZu(src, auf);
    const r = /^\s*:\s*(?:retrofit2\.)?Response<\s*([\w.]+)\s*>/.exec(roh.slice(zu + 1, zu + 200));
    const params = roh.slice(auf + 1, zu);
    const b = /@Body\s+\w+\s*:\s*([\w.]+)\s*[,)=\s]/.exec(params + ')');
    const methode = m[1] === 'HTTP' ? m[2] ?? '' : m[1] ?? '';
    aus.push({ methode, pfad: '/' + (m[1] === 'HTTP' ? m[3] : m[2]), typ: r ? (r[1] ?? '').split('.').pop() ?? null : null,
      anfrage: [...params.matchAll(/@Query\("([^"]+)"\)/g)].map(q => ({ name: q[1] ?? '' })),
      rumpf: b ? (b[1] ?? '').split('.').pop() ?? null : null });
  }
  return aus;
}

/**
 * Felder, die eine Route absichtlich weglässt, obwohl das Modell sie kennt.
 * Schlüssel: "<Route> <Klasse>.<Feld>". Jeder Eintrag braucht einen Grund;
 * alles andere, was fehlt, ist ein Fehler — auch mit Standardwert, denn der
 * Standardwert überdeckt sonst still, dass der Server ein Feld vergisst.
 * @type {Map<string, string>}
 */
const FEHLEN_ERLAUBT = new Map([
  ['/api/v1/sets SetsResponse.themes',
   'kommt nur mit der ersten Seite eines geblätterten Abrufs; ohne sie behält die App ihre Liste'],
  ['/api/v1/parts/manual PartValuationItem.acquisitions',
   'die Liste führt keine Erfassungen; die Detailansicht lädt sie über /acquisitions'],
  ['/api/v1/minifigs/manual FigValuationItem.acquisitions',
   'die Liste führt keine Erfassungen; die Detailansicht lädt sie über /acquisitions'],
  ['/api/v1/sets/exists/{setNumber} SetExistsResponse.is_self', 'nur, wenn es das Set im Blickfeld gibt'],
  // Besitzer nennt der Server nur im Haushalt (withOwners); allein gibt es keine.
  ...[['/api/v1/sets', 'SetItem'], ['/api/v1/sets/{setNumber}', 'SetItem'], ['/api/v1/minifigs', 'Minifig'],
    ['/api/v1/sets/{setNumber}/minifigs-list', 'Minifig'], ['/api/v1/parts/manual', 'PartValuationItem'],
    ['/api/v1/minifigs/manual', 'FigValuationItem'], ['/api/v1/finance/parts-valuation', 'PartValuationItem'],
    ['/api/v1/finance/minifigs-valuation', 'FigValuationItem']]
    .map(([route, klasse]) => /** @type {[string, string]} */ ([`${route} ${klasse}.owners`, 'nur im Haushalt'])),
]);

/**
 * Passt ein Kotlin-Typ zu einem JSON-Schema des Vertrags (docs/openapi.json)?
 * Geprüft wird, was die App beim Lesen braucht: Jedes Feld des Modells steht
 * im Schema (unter seinem JSON-Namen), mit passendem Typ; was das Schema null
 * sein lässt, ist in Kotlin nullbar; was das Schema weglassen darf, hat in …
 * Ausführlich: docs/begruendungen/scripts/kotlin-vertrag.js.md#vergleiche
 * @param {KTyp} t @param {any} schema @param {KModelle} modelle
 * @param {(ref: string) => any} aufloesen  `$ref` → Schema
 * @param {string} [ort] @param {{ route?: string, standardwerte?: boolean }} [o]
 * @returns {string[]}
 */
function vergleiche(t, schema, modelle, aufloesen, ort = '$', o = {}) {
  const s = schema && schema.$ref ? aufloesen(schema.$ref) : schema;
  if (!s || typeof s !== 'object') return [`${ort}: kein Schema`];
  const zweige = Array.isArray(s.anyOf) ? s.anyOf.map((/** @type {any} */ z) => (z.$ref ? aufloesen(z.$ref) : z)) : null;
  if (zweige) {
    const ohneNull = zweige.filter((/** @type {any} */ z) => z.type !== 'null');
    if (ohneNull.length < zweige.length && !t.nullbar) return [`${ort}: Schema erlaubt null, Kotlin nicht (${beschreibe(t)})`];
    // Jede erlaubte Form muss die App lesen können.
    return ohneNull.flatMap((/** @type {any} */ z) => vergleiche({ ...t, nullbar: true }, z, modelle, aufloesen, ort, o));
  }
  if (s.type === 'null') return t.nullbar ? [] : [`${ort}: Schema sagt null, Kotlin ${beschreibe(t)}`];
  // zod schreibt ein nullbares Primitiv als Typliste: ["string", "null"].
  const typen = Array.isArray(s.type) ? s.type : [s.type];
  if (typen.includes('null') && !t.nullbar) return [`${ort}: Schema erlaubt null, Kotlin nicht (${beschreibe(t)})`];
  const ohneNull = typen.filter((/** @type {string} */ x) => x !== 'null');
  const typ = ohneNull.length === 1 ? ohneNull[0] : ohneNull.join('|') || undefined;
  const falsch = (/** @type {string} */ erwartet) => [`${ort}: Schema ${typ ?? 'beliebig'}, Kotlin ${erwartet}`];
  switch (t.art) {
    case 'string':  return typ === 'string' ? [] : falsch('String');
    case 'boolean': return typ === 'boolean' ? [] : falsch('Boolean');
    case 'int':     return typ === 'integer' ? [] : falsch('Int');
    case 'number':  return typ === 'number' || typ === 'integer' ? [] : falsch('Double');
    case 'liste':
      if (typ !== 'array') return falsch('Liste');
      return vergleiche(t.element ?? { art: 'klasse', nullbar: true }, s.items, modelle, aufloesen, `${ort}[]`, o);
    case 'karte':
      if (typ !== 'object' || !s.additionalProperties || typeof s.additionalProperties !== 'object')
        return falsch('Map');
      return vergleiche(t.wert ?? { art: 'klasse', nullbar: true }, s.additionalProperties, modelle, aufloesen, `${ort}{}`, o);
    case 'klasse': {
      const m = modelle.get(t.name ?? '');
      if (!m) return [];                                     // JsonElement, Any …
      if (typ !== 'object') return falsch(t.name ?? 'Klasse');
      const { route = '', standardwerte = true } = o;
      const pflicht = new Set(s.required ?? []);
      /** @type {string[]} */
      const aus = [];
      for (const f of m.felder) {
        const darfFehlen = f.hatDefault && (f.typ.nullbar || !standardwerte || FEHLEN_ERLAUBT.has(`${route} ${t.name}.${f.json}`));
        const feld = s.properties?.[f.json];
        if (!feld) { if (!darfFehlen) aus.push(`${ort}.${f.json}: fehlt im Schema (${t.name})`); continue; }
        if (!pflicht.has(f.json) && !darfFehlen)
          aus.push(`${ort}.${f.json}: im Schema optional, in Kotlin ${f.hatDefault ? 'ohne erlaubte Lücke' : 'ohne Standardwert'} (${t.name})`);
        aus.push(...vergleiche(f.typ, feld, modelle, aufloesen, `${ort}.${f.json}`, o));
      }
      return aus;
    }
  }
  return [];
}

/** @param {KTyp} t */
const beschreibe = (t) => t.art === 'klasse' ? t.name : t.art;

/** Die Kennungen der Aufzählung Fehlercode: `NAME("kennung")` je Zeile. @param {string} datei */
function kotlinFehlercodes(datei) {
  return [...fs.readFileSync(datei, 'utf8').matchAll(/^\s+[A-Z_]+\("([a-z][a-z0-9_]*)"\)/gm)].map((m) => m[1]);
}

module.exports = { kotlinModelle, kotlinFehlercodes, apiRouten, schreibRouten, vergleiche, typ, FEHLEN_ERLAUBT, apiQuelltext };
