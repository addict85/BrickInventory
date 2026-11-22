#!/usr/bin/env node
'use strict';

/**
 * Writes shared/app-interface.json: which routes the app calls (method, path, query,
 * body and response type) and which fields its models read (per model and in total). The web suite checks the
 * server against this file, not against Kotlin source. With --pruefen only compare
 * (exit 1 on deviation); the Android run does that (android.yml, job vertrag).
 */
const fs = require('node:fs');
const path = require('node:path');
const { apiRouten, schreibRouten, kotlinModelle } = require('./kotlin-contract.js');

const ANDROID = path.join(__dirname, '..', '..');
const TARGET = path.join(ANDROID, '..', 'shared', 'app-interface.json');
const API = path.join(ANDROID, 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'data', 'api');

/** The ch/brickinventoryapp roots of the main sources of all Gradle modules. */
function sourceRoots() {
  return fs
    .readdirSync(ANDROID)
    .filter(m => fs.existsSync(path.join(ANDROID, m, 'build.gradle.kts')))
    .sort()
    .map(m => path.join(ANDROID, m, 'src', 'main', 'java', 'ch', 'brickinventoryapp'))
    .filter(p => fs.existsSync(p));
}

/**
 * What the sign-in screen calls before there is a token, as "METHOD /api/v2/…":
 * LoginViewModel → its `account.x(…)` → the `api.y(…)` in AccountRepositoryImpl.x → AccountApi.y.
 * The server opens exactly these at its entrance (PUBLIC_ROUTES, test/public-entrance-db).
 */
function withoutToken() {
  const read = (/** @type {string} */ ...parts) => fs.readFileSync(path.join(ANDROID, ...parts), 'utf8');
  const KT = ['src', 'main', 'java', 'ch', 'brickinventoryapp'];
  const api = new Map();
  for (const m of fs
    .readFileSync(path.join(API, 'AccountApi.kt'), 'utf8')
    .matchAll(/@(GET|POST|PUT|DELETE)\("(api\/v2[^"]+)"\)[\s\S]*?fun (\w+)\(/g))
    api.set(m[3], `${m[1]} /${m[2]}`);
  const repo = new Map(
    read('core-data', ...KT, 'data', 'account', 'AccountRepositoryImpl.kt')
      .split(/\n\s*override (?:suspend )?fun /)
      .slice(1)
      .map(t => [t.match(/^(\w+)/)?.[1] ?? '', [...t.matchAll(/\bapi\.(\w+)\(/g)].map(m => m[1])]),
  );
  const vm = read('feature-login', ...KT, 'login', 'ui', 'viewmodel', 'LoginViewModel.kt');
  const routes = new Set();
  for (const [, name] of vm.matchAll(/\baccount\.(\w+)\(/g))
    for (const a of repo.get(name ?? '') ?? []) {
      const r = api.get(a ?? '');
      if (!r) throw new Error(`${name} → api.${a} ohne Adresse in AccountApi.kt`);
      routes.add(r);
    }
  if (!routes.size) throw new Error('keine Anmeldeaufrufe ohne Token gefunden — Muster veraltet?');
  return [...routes].sort();
}

function appInterface() {
  const models = kotlinModelle(sourceRoots());
  const routes = [
    ...apiRouten(API).map(r => ({
      method: 'GET',
      path: r.pfad,
      type: r.typ,
      query: r.anfrage.map(a => ({ name: a.name, required: a.pflicht })),
      body: null,
      body_fields: [],
    })),
    ...schreibRouten(API).map(r => ({
      method: r.methode,
      path: r.pfad,
      type: r.typ,
      query: r.anfrage.map(a => ({ name: a.name, required: false })),
      body: r.rumpf,
      body_fields: (models.get(r.rumpf ?? '')?.felder ?? []).map(f => f.json),
    })),
  ].sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
  // Hand-built addresses (streams, image proxy, downloads): up to the first placeholder.
  const addresses = new Set();
  const walk = (/** @type {string} */ d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.kt') && !p.startsWith(API + path.sep))
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/"[^"\n]*?(\/?api\/[^"$?\n]*)/g))
          addresses.add(`/${(m[1] ?? '').replace(/^\//, '')}`);
    }
  };
  for (const w of sourceRoots()) walk(w);
  const fields = new Set();
  for (const m of models.values()) for (const f of m.felder) fields.add(f.json);
  return {
    note: 'Erzeugt von Android-App/tools/contract/app-interface.js aus dem Quelltext der App; nicht von Hand ändern.',
    routes,
    addresses: [...addresses].sort(),
    without_token: withoutToken(),
    response_fields: [...fields].sort(),
    models: Object.fromEntries(
      [...models]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, m]) => [
          name,
          { fields: m.felder.map(f => f.json), required: m.felder.filter(f => !f.hatDefault).map(f => f.json) },
        ]),
    ),
  };
}

module.exports = { ANDROID, API, TARGET, sourceRoots, appInterface };
if (require.main !== module) return;

const text = `${JSON.stringify(appInterface(), null, 2)}\n`;
if (process.argv.includes('--pruefen')) {
  const old = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
  if (old !== text) {
    console.error('shared/app-interface.json ist veraltet: node Android-App/tools/contract/app-interface.js');
    process.exit(1);
  }
  console.log('shared/app-interface.json ist aktuell');
} else {
  fs.writeFileSync(TARGET, text);
  console.log(`geschrieben: ${path.relative(process.cwd(), TARGET)}`);
}
