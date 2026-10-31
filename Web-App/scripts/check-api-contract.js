#!/usr/bin/env node
'use strict';
/**
 * API-Vertrag gegen einen laufenden Server: jede GET-Route der App ohne
 * Platzhalter gegen ihr Kotlin-Modell. Die Schemas entstehen aus dem
 * App-Quelltext (scripts/kotlin-vertrag.js) — es gibt keine Abschrift, die
 * den Modellen hinterherlaufen könnte. Die vollständige Prüfung mit Bestand
 * steht in test/api-vertrag-kotlin-db.test.js.
 *
 *   BASE_URL=http://localhost:3000 TOKEN=… node scripts/check-api-contract.js
 *   BASE_URL=… USERNAME=marco PASSWORD=… node scripts/check-api-contract.js
 *
 * Exit-Code 0 = Vertrag eingehalten, 1 = Abweichungen, 2 = keine Anmeldung.
 */
const path = require('path');
const { kotlinModelle, apiRouten, pruefe } = require('./kotlin-vertrag');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const APP = path.join(__dirname, '..', '..', 'Android-App', 'app', 'src', 'main', 'java', 'ch', 'brickinventoryapp');

async function token() {
  if (process.env.TOKEN) return process.env.TOKEN;
  const { USERNAME, PASSWORD } = process.env;
  if (!USERNAME || !PASSWORD) { console.error('Bitte TOKEN oder USERNAME+PASSWORD setzen.'); process.exit(2); }
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD, label: 'contract-check' }) });
  const j = await r.json();
  if (!j.success) { console.error('Anmeldung fehlgeschlagen:', j.error); process.exit(2); }
  return j.token;
}

(async () => {
  const t = await token();
  const modelle = kotlinModelle(APP);
  const routen = apiRouten(path.join(APP, 'data', 'api'))
    .filter(r => r.typ && modelle.has(r.typ) && !r.pfad.includes('{') && !r.anfrage.some(q => q.pflicht));
  let falsch = 0;
  for (const r of routen) {
    let fehler;
    try {
      const a = await fetch(BASE + r.pfad, { headers: { Authorization: `Bearer ${t}` } });
      fehler = a.ok ? pruefe(await a.json(), { art: 'klasse', name: r.typ ?? '', nullbar: false }, modelle, '$', { route: r.pfad })
                    : [`HTTP ${a.status}`];
    } catch (e) { fehler = [`Anfrage fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`]; }
    if (fehler.length) {
      falsch++;
      console.error(`✗ GET ${r.pfad} (${r.typ})`);
      [...new Set(fehler.map((/** @type {string} */ f) => f.replace(/\[\d+\]/g, '[i]')))].slice(0, 10)
        .forEach(f => console.error(`    ${f}`));
    } else console.log(`✓ GET ${r.pfad} (${r.typ})`);
  }
  if (falsch) { console.error(`\n${falsch} von ${routen.length} Routen weichen vom Android-Vertrag ab.`); process.exit(1); }
  console.log(`\nAlle ${routen.length} Routen entsprechen den Kotlin-Modellen.`);
})();
