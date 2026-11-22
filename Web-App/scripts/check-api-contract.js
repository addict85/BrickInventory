#!/usr/bin/env node
'use strict';

/**
 * API contract against a running server: every GET route of the contract
 * (src/contract/) without placeholders against its schema. The complete
 * check with inventory is in test/contract-read-db.test.js; this script
 * is for a real inventory (after `npm run build`).
 */
const path = require('node:path');
const { CONTRACT } = require(path.join(__dirname, '..', 'dist', 'src', 'contract', 'index.js'));

const BASE = process.env.BASE_URL || 'http://localhost:3000';
async function token() {
  if (process.env.TOKEN) return process.env.TOKEN;
  const { USERNAME, PASSWORD } = process.env;
  if (!USERNAME || !PASSWORD) {
    console.error('Bitte TOKEN oder USERNAME+PASSWORD setzen.');
    process.exit(2);
  }
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD, label: 'contract-check' }),
  });
  const j = await r.json();
  if (!j.success) {
    console.error('Anmeldung fehlgeschlagen:', j.error);
    process.exit(2);
  }
  return j.token;
}

(async () => {
  const t = await token();
  /** @type {[string, { response?: import('zod').ZodType }][]} */
  const routen = Object.entries(CONTRACT).filter(([k, r]) => k.startsWith('GET ') && !k.includes(':') && r.response);
  let wrong = 0;
  for (const [key, r] of routen) {
    const path = key.slice(4);
    /** @type {string[]} */
    let error;
    try {
      const a = await fetch(BASE + path, { headers: { Authorization: `Bearer ${t}` } });
      const result = a.ok ? r.response?.safeParse(await a.json()) : undefined;
      error = !a.ok
        ? [`HTTP ${a.status}`]
        : result && !result.success
          ? result.error.issues.map(i => `$.${i.path.join('.')}: ${i.message}`)
          : [];
    } catch (e) {
      error = [`Anfrage fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`];
    }
    if (error.length) {
      wrong++;
      console.error(`✗ ${key}`);
      [...new Set(error.map(f => f.replace(/\.\d+\./g, '.i.')))].slice(0, 10).forEach(f => {
        console.error(`    ${f}`);
      });
    } else console.log(`✓ ${key}`);
  }
  if (wrong) {
    console.error(`\n${wrong} von ${routen.length} Routen weichen vom Vertrag ab.`);
    process.exit(1);
  }
  console.log(`\nAlle ${routen.length} Routen halten ihren Vertrag.`);
})();
