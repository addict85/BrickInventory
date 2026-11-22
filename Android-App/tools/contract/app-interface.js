#!/usr/bin/env node
'use strict';

/**
 * Writes shared/app-schnittstelle.json: which routes the app calls (method, path, query,
 * body and response type) and which fields its models read (per model and in total). The web suite checks the
 * server against this file, not against Kotlin source. With --pruefen only compare
 * (exit 1 on deviation); the Android run does that (android.yml, job vertrag).
 */
const fs = require('node:fs');
const path = require('node:path');
const { apiRouten, schreibRouten, kotlinModelle } = require('./kotlin-contract.js');

const ANDROID = path.join(__dirname, '..', '..');
const ZIEL = path.join(ANDROID, '..', 'shared', 'app-schnittstelle.json');
const API = path.join(ANDROID, 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'api');

/** The ch/brickinventoryapp roots of the main sources of all Gradle modules. */
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
  // Hand-built addresses (streams, image proxy, downloads): up to the first placeholder.
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
    hinweis: 'Erzeugt von Android-App/tools/contract/app-interface.js aus dem Quelltext der App; nicht von Hand ändern.',
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
    console.error('shared/app-schnittstelle.json ist veraltet: node Android-App/tools/contract/app-interface.js');
    process.exit(1);
  }
  console.log('shared/app-schnittstelle.json ist aktuell');
} else {
  fs.writeFileSync(ZIEL, text);
  console.log(`geschrieben: ${path.relative(process.cwd(), ZIEL)}`);
}
