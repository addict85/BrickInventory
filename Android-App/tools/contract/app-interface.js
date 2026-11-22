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

/**
 * What the sign-in screen calls before there is a token, as "METHOD /api/v1/…":
 * AnmeldungViewModel → its `konto.x(…)` → the `api.y(…)` in KontoRepositoryImpl.x → AccountApi.y.
 * The server opens exactly these at its entrance (PUBLIC_ROUTES, test/public-entrance-db).
 */
function ohneToken() {
  const lies = (/** @type {string} */ ...teile) => fs.readFileSync(path.join(ANDROID, ...teile), 'utf8');
  const KT = ['src', 'main', 'java', 'ch', 'brickinventoryapp'];
  const api = new Map();
  for (const m of fs.readFileSync(path.join(API, 'AccountApi.kt'), 'utf8').matchAll(
    /@(GET|POST|PUT|DELETE)\("(api\/v1[^"]+)"\)[\s\S]*?fun (\w+)\(/g,
  ))
    api.set(m[3], `${m[1]} /${m[2]}`);
  const repo = new Map(
    lies('core-data', ...KT, 'data', 'repository', 'KontoRepositoryImpl.kt')
      .split(/\n\s*override (?:suspend )?fun /)
      .slice(1)
      .map(t => [t.match(/^(\w+)/)?.[1] ?? '', [...t.matchAll(/\bapi\.(\w+)\(/g)].map(m => m[1])]),
  );
  const vm = lies('feature-login', ...KT, 'login', 'ui', 'viewmodel', 'AnmeldungViewModel.kt');
  const routen = new Set();
  for (const [, name] of vm.matchAll(/\bkonto\.(\w+)\(/g))
    for (const a of repo.get(name ?? '') ?? []) {
      const r = api.get(a ?? '');
      if (!r) throw new Error(`${name} → api.${a} ohne Adresse in AccountApi.kt`);
      routen.add(r);
    }
  return [...routen].sort();
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
    ohne_token: ohneToken(),
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
