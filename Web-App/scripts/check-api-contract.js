#!/usr/bin/env node
/**
 * API-Vertrags-Check: Server-Antworten gegen die Kotlin-Modelle der
 * Android-App prüfen.
 *
 * Hintergrund: Der Vertrag zwischen /api/v1 und der Android-App existierte
 * bisher nur implizit — Feld-Umbenennungen oder Typ-Änderungen auf Server-
 * Seite fielen erst zur Laufzeit in der App auf (im schlimmsten Fall als
 * stille kotlinx.serialization-Fehler, wie beim fehlenden @Serializable
 * damals). Dieses Skript kodiert die Erwartungen der wichtigsten Kotlin-
 * Modelle (Models.kt) als Schemas und prüft die ECHTEN Server-Antworten
 * dagegen.
 *
 * WICHTIG: Bei Änderungen an Models.kt in der Android-App müssen die
 * Schemas hier nachgezogen werden — das Skript ist der Single Point, der
 * die Drift sichtbar macht.
 *
 * Verwendung (Server muss laufen):
 *   BASE_URL=http://localhost:3000 USERNAME=marco PASSWORD=... node scripts/check-api-contract.js
 *   # oder mit bestehendem Token:
 *   BASE_URL=http://localhost:3000 TOKEN=abc123... node scripts/check-api-contract.js
 *
 * Exit-Code 0 = Vertrag eingehalten, 1 = Abweichungen gefunden.
 */
'use strict';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

// ── Schema-Notation ───────────────────────────────────────────────────────────
// 'string' | 'number' | 'int' | 'boolean'  — Pflichtfeld dieses Typs
// '?string' | '?number' | '?int'           — optional/nullable (fehlend, null oder Typ)
// [schema]                                 — Array, jedes Element gegen schema
// {..}                                     — verschachteltes Objekt (Pflicht)
// '?{'                                     — als Präfix-Konvention hier nicht nötig

// Spiegelt Models.kt der Android-App:
const SetSchema = {
  set_number:     'string',      // SetItem.setNumber — einziges Pflichtfeld
  name:           '?string',
  year:           '?int',
  theme:          '?string',
  pieces:         '?int',
  minifigs:       '?int',
  quantity:       '?int',        // Kotlin-Default 1 → darf fehlen, aber nicht z.B. String sein
  image_url:      '?string',
  image_local:    '?string',
  added_at:       '?string',
  purchase_price: '?number',
};

const CHECKS = [
  {
    name: 'GET /api/v1/sets  (SetsResponse)',
    path: '/api/v1/sets',
    schema: { success: 'boolean', count: '?int', sets: [SetSchema] },
  },
  {
    name: 'GET /api/v1/stats  (StatsResponse/DashboardStats)',
    path: '/api/v1/stats',
    schema: {
      success: 'boolean',
      stats: {
        total_sets: '?int', total_quantity: '?int', total_pieces: '?int',
        total_instructions: '?int', total_parts: '?int', total_minifigs: '?int',
      },
    },
  },
  {
    name: 'GET /api/v1/auth/me',
    path: '/api/v1/auth/me',
    schema: { success: 'boolean', user: { id: 'int', username: 'string' } },
  },
  {
    name: 'GET /api/v1/catalog/meta  (CatalogMetaResponse)',
    path: '/api/v1/catalog/meta',
    schema: {
      success: 'boolean',
      themes: [{ id: 'int', name: 'string', set_count: '?int' }],
      year_min: '?int', year_max: '?int',
      year_counts: [{ year: 'int', n: 'int' }],
    },
  },
  {
    name: 'GET /api/v1/catalog/sets  (CatalogSetsResponse)',
    path: '/api/v1/catalog/sets?limit=5',
    schema: {
      success: 'boolean', total: '?int', page: '?int', pages: '?int',
      sets: [{
        set_number: 'string', name: '?string', year: '?int',
        theme_id: '?int', theme_name: '?string', num_parts: '?int',
        image_url: '?string',
        owned: 'boolean', owned_quantity: '?int',
      }],
    },
  },
];

// ── Validierung ───────────────────────────────────────────────────────────────
/**
 * Ein Einzelwert gegen eine Typangabe pruefen.
 *
 * JSDoc statt TypeScript-Syntax: Das hier ist eine .js-Datei, die per node
 * direkt laufen soll — sie wird nicht uebersetzt. `checkJs` liest die
 * Anmerkungen trotzdem, der Pruefer greift also genauso.
 *
 * @param {unknown} value
 * @param {string} type  z. B. 'string', '?int' (das ? macht das Feld optional)
 * @param {string} path  Pfad im Antwortobjekt, fuer die Meldung
 * @param {string[]} errors  Sammelliste, wird beschrieben
 */
function checkType(value, type, path, errors) {
  const optional = type.startsWith('?');
  const t = optional ? type.slice(1) : type;
  if (value === undefined || value === null) {
    if (!optional) errors.push(`${path}: Pflichtfeld fehlt oder ist null`);
    return;
  }
  if (t === 'string'  && typeof value !== 'string')  errors.push(`${path}: erwartet string, ist ${typeof value} (${JSON.stringify(value).slice(0, 40)})`);
  if (t === 'boolean' && typeof value !== 'boolean') errors.push(`${path}: erwartet boolean, ist ${typeof value}`);
  if (t === 'number'  && typeof value !== 'number')  errors.push(`${path}: erwartet number, ist ${typeof value} (${JSON.stringify(value).slice(0, 40)}) — Achtung: kotlinx.serialization parst "1.5" (String) NICHT als Double`);
  if (t === 'int' && (typeof value !== 'number' || !Number.isInteger(value))) errors.push(`${path}: erwartet Int, ist ${typeof value} ${JSON.stringify(value).slice(0, 40)}`);
}

/**
 * Ein Antwortobjekt rekursiv gegen ein Schema pruefen.
 *
 * @param {unknown} obj
 * @param {unknown} schema  Zeichenkette (Typ), Array (je Element) oder Objekt
 * @param {string} path
 * @param {string[]} errors
 */
function validate(obj, schema, path, errors) {
  if (Array.isArray(schema)) {
    if (!Array.isArray(obj)) { errors.push(`${path}: erwartet Array, ist ${typeof obj}`); return; }
    // Alle Elemente prüfen — Typ-Drift betrifft oft nur einzelne Zeilen (z.B. NULL aus altem Datenbestand)
    obj.forEach((el, i) => validate(el, schema[0], `${path}[${i}]`, errors));
    return;
  }
  if (typeof schema === 'string') { checkType(obj, schema, path, errors); return; }
  if (obj === undefined || obj === null) { errors.push(`${path}: Objekt fehlt`); return; }
  // Ab hier ist beides ein Objekt: Die drei Wachen darueber haben Array,
  // Zeichenkette und null/undefined bereits abgefangen. Die Einengung steht
  // ausgeschrieben da, statt die Parameter oben auf `any` zu setzen — dann
  // pruefte der Rest der Funktion naemlich auch nichts mehr.
  const felder = /** @type {Record<string, unknown>} */ (schema);
  const werte  = /** @type {Record<string, unknown>} */ (obj);
  for (const [key, sub] of Object.entries(felder)) validate(werte[key], sub, `${path}.${key}`, errors);
}

// ── Ablauf ────────────────────────────────────────────────────────────────────
async function getToken() {
  if (process.env.TOKEN) return process.env.TOKEN;
  const { USERNAME, PASSWORD } = process.env;
  if (!USERNAME || !PASSWORD) {
    console.error('Bitte TOKEN oder USERNAME+PASSWORD als Umgebungsvariablen setzen.');
    process.exit(2);
  }
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD, label: 'contract-check' }),
  });
  const j = await r.json();
  if (!j.success) { console.error('Login fehlgeschlagen:', j.error); process.exit(2); }
  return j.token;
}

(async () => {
  const token = await getToken();
  let failed = 0;
  for (const check of CHECKS) {
    /** @type {string[]} */
    const errors = [];
    try {
      const r = await fetch(BASE + check.path, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { errors.push(`HTTP ${r.status}`); }
      else validate(await r.json(), check.schema, '$', errors);
    } catch (e) { errors.push(`Request fehlgeschlagen: ${e.message}`); }
    if (errors.length) {
      failed++;
      console.error(`✗ ${check.name}`);
      // Gleiche Fehler nicht 500× wiederholen (Array-Checks)
      [...new Set(errors.map(e => e.replace(/\[\d+\]/, '[i]')))].slice(0, 10).forEach(e => console.error(`    ${e}`));
    } else {
      console.log(`✓ ${check.name}`);
    }
  }
  if (failed) { console.error(`\n${failed} Endpoint(s) weichen vom Android-Vertrag ab.`); process.exit(1); }
  console.log('\nAlle geprüften Endpoints entsprechen den Kotlin-Modellen.');
})();
