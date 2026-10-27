'use strict';
/**
 * Der Vertrag mit der Android-App, gelesen aus ihrem eigenen Quelltext:
 * die @Serializable-Datenklassen und die GET-Routen aus BrickApiService.kt.
 * Handgeschriebene Schemas liefen den Modellen hinterher; diese hier können
 * es nicht, weil sie aus ihnen entstehen.
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

/** Alle @Serializable-Klassen: Name → Felder. @param {string} wurzel @returns {KModelle} */
function kotlinModelle(wurzel) {
  /** @type {KModelle} */
  const modelle = new Map();
  for (const datei of kotlinDateien(wurzel)) {
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
  const src = entschaerfe(fs.readFileSync(serviceDatei, 'utf8'));
  const roh = fs.readFileSync(serviceDatei, 'utf8');
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
 * Passt `wert` zum Kotlin-Typ? Liefert die Abweichungen als Text.
 * Strenger als die App selbst: null in einem nicht-nullbaren Feld zählt
 * auch dann, wenn coerceInputValues es zur Laufzeit auf den Standard setzt —
 * genau diese stille Verbiegung soll hier auffallen.
 * @param {unknown} wert @param {KTyp} t @param {KModelle} modelle @param {string} [ort]
 * @returns {string[]}
 */
function pruefe(wert, t, modelle, ort = '$') {
  if (wert === null || wert === undefined) return t.nullbar ? [] : [`${ort}: null statt ${beschreibe(t)}`];
  switch (t.art) {
    case 'string':  return typeof wert === 'string' ? [] : [`${ort}: ${art(wert)} statt String`];
    case 'boolean': return typeof wert === 'boolean' ? [] : [`${ort}: ${art(wert)} statt Boolean`];
    case 'int':     return Number.isInteger(wert) ? [] : [`${ort}: ${art(wert)} ${JSON.stringify(wert)} statt Int`];
    case 'number':  return typeof wert === 'number' ? [] : [`${ort}: ${art(wert)} statt Double`];
    case 'liste':
      if (!Array.isArray(wert)) return [`${ort}: ${art(wert)} statt Liste`];
      return wert.flatMap((w, i) => pruefe(w, t.element ?? { art: 'klasse', nullbar: true }, modelle, `${ort}[${i}]`));
    case 'karte':
      if (typeof wert !== 'object' || Array.isArray(wert)) return [`${ort}: ${art(wert)} statt Map`];
      return Object.entries(wert).flatMap(([k, w]) => pruefe(w, t.wert ?? { art: 'klasse', nullbar: true }, modelle, `${ort}.${k}`));
    case 'klasse': {
      const m = modelle.get(t.name ?? '');
      if (!m) return [];                                     // Any, JsonElement, Unit …
      if (typeof wert !== 'object' || Array.isArray(wert)) return [`${ort}: ${art(wert)} statt ${t.name}`];
      /** @type {string[]} */
      const aus = [];
      const obj = /** @type {Record<string, unknown>} */ (wert);
      for (const f of m.felder) {
        const da = Object.prototype.hasOwnProperty.call(obj, f.json);
        if (!da) { if (!f.hatDefault && !f.typ.nullbar) aus.push(`${ort}.${f.json}: fehlt (${t.name}, Pflichtfeld)`); continue; }
        aus.push(...pruefe(obj[f.json], f.typ, modelle, `${ort}.${f.json}`));
      }
      return aus;
    }
  }
  return [];
}

/** @param {unknown} w */
const art = (w) => Array.isArray(w) ? 'Liste' : typeof w;
/** @param {KTyp} t */
const beschreibe = (t) => t.art === 'klasse' ? t.name : t.art;

module.exports = { kotlinModelle, apiRouten, pruefe, typ };
