#!/usr/bin/env node
'use strict';

/**
 * Schreibt shared/app-schnittstelle.json: welche Routen die App ruft (Methode, Pfad, Abfrage,
 * Rumpf- und Antworttyp) und welche Felder ihre Modelle lesen (je Modell und gesamt). Die Web-Suite prüft den
 * Server gegen diese Datei, nicht gegen Kotlin-Quelltext. Mit --pruefen nur vergleichen
 * (Rückgabe 1 bei Abweichung); das tut der Android-Lauf (android.yml, Job vertrag).
 */
const fs = require('node:fs');
const path = require('node:path');
const { apiRouten, schreibRouten, kotlinModelle } = require('./kotlin-vertrag.js');

const ANDROID = path.join(__dirname, '..', '..');
const ZIEL = path.join(ANDROID, '..', 'shared', 'app-schnittstelle.json');
const API = path.join(ANDROID, 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'api');

/** Die Wurzeln ch/brickinventoryapp der Hauptquellen aller Gradle-Module. */
function quellwurzeln() {
  return fs
    .readdirSync(ANDROID)
    .filter(m => fs.existsSync(path.join(ANDROID, m, 'build.gradle.kts')))
    .sort()
    .map(m => path.join(ANDROID, m, 'src', 'main', 'java', 'ch', 'brickinventoryapp'))
    .filter(p => fs.existsSync(p));
}

function schnittstelle() {
  const modelle = kotlinModelle(quellwurzeln());
  const routen = [
    ...apiRouten(API).map(r => ({
      methode: 'GET',
      pfad: r.pfad,
      typ: r.typ,
      abfrage: r.anfrage,
      rumpf: null,
      rumpffelder: [],
    })),
    ...schreibRouten(API).map(r => ({
      methode: r.methode,
      pfad: r.pfad,
      typ: r.typ,
      abfrage: r.anfrage.map(a => ({ name: a.name, pflicht: false })),
      rumpf: r.rumpf,
      rumpffelder: (modelle.get(r.rumpf ?? '')?.felder ?? []).map(f => f.json),
    })),
  ].sort((a, b) => `${a.pfad} ${a.methode}`.localeCompare(`${b.pfad} ${b.methode}`));
  // Von Hand gebaute Adressen (Ströme, Bild-Proxy, Downloads): bis zum ersten Platzhalter.
  const adressen = new Set();
  const lauf = (/** @type {string} */ d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) lauf(p);
      else if (e.name.endsWith('.kt') && !p.startsWith(API + path.sep))
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/"[^"\n]*?(\/?api\/[^"$?\n]*)/g))
          adressen.add(`/${(m[1] ?? '').replace(/^\//, '')}`);
    }
  };
  for (const w of quellwurzeln()) lauf(w);
  const felder = new Set();
  for (const m of modelle.values()) for (const f of m.felder) felder.add(f.json);
  return {
    hinweis: 'Erzeugt von Android-App/tools/vertrag/app-schnittstelle.js aus dem Quelltext der App; nicht von Hand ändern.',
    routen,
    adressen: [...adressen].sort(),
    antwortfelder: [...felder].sort(),
    modelle: Object.fromEntries(
      [...modelle]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, m]) => [
          name,
          { felder: m.felder.map(f => f.json), pflicht: m.felder.filter(f => !f.hatDefault).map(f => f.json) },
        ]),
    ),
  };
}

module.exports = { ANDROID, API, quellwurzeln, schnittstelle };
if (require.main !== module) return;

const text = `${JSON.stringify(schnittstelle(), null, 2)}\n`;
if (process.argv.includes('--pruefen')) {
  const alt = fs.existsSync(ZIEL) ? fs.readFileSync(ZIEL, 'utf8') : '';
  if (alt !== text) {
    console.error('shared/app-schnittstelle.json ist veraltet: node Android-App/tools/vertrag/app-schnittstelle.js');
    process.exit(1);
  }
  console.log('shared/app-schnittstelle.json ist aktuell');
} else {
  fs.writeFileSync(ZIEL, text);
  console.log(`geschrieben: ${path.relative(process.cwd(), ZIEL)}`);
}
