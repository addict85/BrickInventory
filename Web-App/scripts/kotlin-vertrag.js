'use strict';
/**
 * Die Android-App, gelesen aus ihrem eigenen Quelltext: die Routen aus data/api/
 * (je Bereich eine Datei) und die Fehlercodes. Die Kotlin-Typen selbst erzeugt
 * vertrag-kotlin-dtos.js aus dem Vertrag; vertrag-kotlin.test.js prüft, dass jede
 * Route den erzeugten Typ ihres Schemas nimmt.
 */
const fs = require('node:fs');
const path = require('node:path');

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
  const fd = fs.openSync(pfad, 'r');
  try {
    if (!fs.fstatSync(fd).isDirectory()) return fs.readFileSync(fd, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
  return kotlinDateien(pfad)
    .sort()
    .map(d => fs.readFileSync(d, 'utf8'))
    .join('\n');
}

/** Kommentare und Zeichenketten so leeren, dass Positionen gleich bleiben. @param {string} src */
function entschaerfe(src) {
  let aus = '',
    i = 0;
  while (i < src.length) {
    const c = src[i],
      n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        aus += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && n === '*') {
      const e = src.indexOf('*/', i + 2);
      const bis = e < 0 ? src.length : e + 2;
      for (; i < bis; i++) aus += src[i] === '\n' ? '\n' : ' ';
      continue;
    }
    if (c === '"') {
      // Zeichenketten bleiben stehen (SerialName braucht sie), nur ihr Inhalt
      // darf keine Klammern zählen lassen.
      let j = i + 1;
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') j++;
        j++;
      }
      aus += src.slice(i, j + 1).replace(/[(){}<>,]/g, ' ');
      i = j + 1;
      continue;
    }
    aus += c;
    i++;
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

/** Die nächste Funktion ab `ab`, ob suspend oder nicht (ein synchroner Call nimmt `fun`). @param {string} src @param {number} ab */
function naechsteFunktion(src, ab) {
  const m = /\bfun\s/.exec(src.slice(ab));
  return m ? ab + m.index : -1;
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
    const fn = naechsteFunktion(src, m.index);
    const auf = src.indexOf('(', fn);
    const zu = bisZu(src, auf);
    const rest = roh.slice(zu + 1, zu + 200);
    const r = /^\s*:\s*(?:retrofit2\.)?(?:Response|Call)<\s*([\w.]+)\s*>/.exec(rest);
    const name = r ? ((r[1] ?? '').split('.').pop() ?? null) : null;
    const params = roh.slice(auf + 1, zu);
    aus.push({
      pfad: '/' + m[1],
      typ: name,
      anfrage: [...params.matchAll(/@Query\("([^"]+)"\)\s*\w+\s*:\s*([\w?]+)(\s*=)?/g)].map(q => ({
        name: q[1] ?? '',
        pflicht: !(q[2] ?? '').endsWith('?') && !q[3],
      })),
    });
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
  for (const m of roh.matchAll(
    /@(POST|PUT|DELETE|PATCH|HTTP)\((?:method\s*=\s*)?"([^"]+)"(?:,\s*path\s*=\s*"([^"]+)")?[^)]*\)/g,
  )) {
    const fn = naechsteFunktion(src, m.index);
    const auf = src.indexOf('(', fn);
    const zu = bisZu(src, auf);
    const r = /^\s*:\s*(?:retrofit2\.)?(?:Response|Call)<\s*([\w.]+)\s*>/.exec(roh.slice(zu + 1, zu + 200));
    const params = roh.slice(auf + 1, zu);
    const b = /@Body\s+\w+\s*:\s*([\w.]+)\s*[,)=\s]/.exec(params + ')');
    const methode = m[1] === 'HTTP' ? (m[2] ?? '') : (m[1] ?? '');
    aus.push({
      methode,
      pfad: '/' + (m[1] === 'HTTP' ? m[3] : m[2]),
      typ: r ? ((r[1] ?? '').split('.').pop() ?? null) : null,
      anfrage: [...params.matchAll(/@Query\("([^"]+)"\)/g)].map(q => ({
        name: q[1] ?? '',
      })),
      rumpf: b ? ((b[1] ?? '').split('.').pop() ?? null) : null,
    });
  }
  return aus;
}

/** Die Kennungen der Aufzählung Fehlercode: `NAME("kennung")` je Zeile. @param {string} datei */
function kotlinFehlercodes(datei) {
  return [...fs.readFileSync(datei, 'utf8').matchAll(/^\s+[A-Z_]+\("([a-z][a-z0-9_]*)"\)/gm)].map(m => m[1]);
}

module.exports = {
  kotlinFehlercodes,
  apiRouten,
  schreibRouten,
  apiQuelltext,
};
