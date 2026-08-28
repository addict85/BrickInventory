/**
 * API-Inventar: JEDER Endpunkt beider Router-Familien muss hier klassifiziert
 * sein. Der Test parst die Routen-Dateien; taucht ein neuer Endpunkt auf, der
 * hier fehlt, wird die Suite rot — so kann keine API mehr ungeprüft/undoku-
 * mentiert dazukommen. Umgekehrt melden verwaiste Einträge entfernte Routen.
 *
 * Kategorien:
 *   paritaet         — Lese-Paar Webapp↔Android, deep-verglichen in api-parity
 *   paritaet-schreib — Schreib-Paar, Effekt-Vergleich in api-parity
 *   paar-extern      — Paar existiert, ruft aber externe APIs (Rebrickable/
 *                      Brickset/BrickLink) — nicht automatisiert vergleichbar
 *   nur-v1           — nur unter /api/v1 implementiert; wird von BEIDEN
 *                      Clients genutzt (requireToken akzeptiert Sessions) oder
 *                      ist Android-spezifisch (z.B. Barcode)
 *   nur-web          — Webapp-spezifisch (Session-Auth-Flows, Datei-Exporte,
 *                      Uploads, SSE-Streams, Admin-UI der Webapp)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/router\.(get|post|put|delete)\(\s*'([^']+)'/g)]
    .map(m => [m[1].toUpperCase(), m[2]]);
}

function inventory() {
  const eps = new Set();
  for (const f of ['auth', 'sets', 'parts', 'finance', 'settings', 'minifigs'])
    for (const [m, p] of scan(path.join(ROOT, 'routes', `${f}.ts`)))
      eps.add(`${m} /api/${f}${p === '/' ? '' : p}`);
  for (const f of fs.readdirSync(path.join(ROOT, 'routes', 'api_v1')))
    if (f.endsWith('.ts') && !['index.ts', 'middleware.ts'].includes(f))
      for (const [m, p] of scan(path.join(ROOT, 'routes', 'api_v1', f)))
        eps.add(`${m} /api/v1${p}`);
  // Dynamisch registrierte Erfassungs-Routen (registerAcquisitionRoutes):
  for (const base of ['/sets/:setNumber/acquisitions', '/parts/:partNumber/:colorId/acquisitions', '/minifigs/:figNumber/acquisitions'])
    for (const m of ['PUT', 'DELETE'])
      eps.add(`${m} /api/v1${base}/:acqId`);
  return eps;
}

// ── Vollständige Klassifikation (Stand siehe Test-Fehlermeldung bei Drift) ──
const C = {
  // Lese-Paritäts-Paare (api-parity.test.js, PAIRS)
  'GET /api/v1/sets': 'paritaet',
  'GET /api/v1/sets/:setNumber': 'paritaet',
  'GET /api/v1/parts': 'paritaet',
  'GET /api/v1/parts/colors': 'paritaet',
  'GET /api/v1/parts/stats': 'paritaet',
  'GET /api/v1/parts/brick-colors': 'paritaet',
  'GET /api/v1/parts/bl-color-map': 'paritaet',
  'GET /api/v1/parts/manual': 'paritaet',
  'GET /api/v1/minifigs': 'paritaet',
  'GET /api/v1/minifigs/manual': 'paritaet',
  'GET /api/settings': 'paritaet',                   'GET /api/v1/settings': 'paritaet',
      'GET /api/v1/sets/:setNumber/acquisitions': 'paritaet',
 'GET /api/v1/parts/:partNumber/:colorId/acquisitions': 'paritaet',
 'GET /api/v1/minifigs/:figNumber/acquisitions': 'paritaet',

  // Schreib-Paritäts-Paare (api-parity.test.js, Effekt-Vergleich)
  'PUT /api/v1/sets/:setNumber': 'paritaet-schreib',
  'DELETE /api/v1/sets/:setNumber': 'paritaet-schreib',
 'PUT /api/v1/sets/:setNumber/acquisitions/:acqId': 'paritaet-schreib',

  // Paare mit externen API-Aufrufen — Parität nicht automatisiert prüfbar
  'POST /api/v1/sets': 'paar-extern',
  'POST /api/v1/parts': 'paar-extern',
  'POST /api/v1/minifigs': 'paar-extern',
  'PUT /api/v1/parts/:partNumber/:colorId': 'paar-extern',
  'DELETE /api/v1/parts/:partNumber/:colorId': 'paar-extern',
  'PUT /api/v1/minifigs/:figNumber': 'paar-extern',
  'DELETE /api/v1/minifigs/:figNumber': 'paar-extern',
 'DELETE /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId': 'paar-extern',
  'PUT /api/v1/parts/:partNumber/:colorId/acquisitions/:acqId': 'paar-extern',
  'PUT /api/v1/minifigs/:figNumber/acquisitions/:acqId': 'paar-extern',
 'DELETE /api/v1/minifigs/:figNumber/acquisitions/:acqId': 'paar-extern',
 'DELETE /api/v1/sets/:setNumber/acquisitions/:acqId': 'paar-extern',

  // Nur /api/v1 — von beiden Clients (oder nur Android) genutzt
  // Etappe 6: zusammengelegt — nur noch die v1-Adresse, beide Clients rufen
  // sie auf. Die Zustands-Auflösung selbst steht in utils/settings.ts.
  'GET /api/v1/stats': 'nur-v1',
  'GET /api/v1/settings/default-condition': 'nur-v1',
  'GET /api/v1/settings/user/default-condition': 'nur-v1',
  'GET /api/v1/minifigs/stats': 'nur-v1',
  'GET /api/v1/sets/exists/:setNumber': 'nur-v1',
  'GET /api/v1/catalog/year-offset': 'nur-v1',
  'GET /api/v1/catalog/year-verteilung': 'nur-v1',
  // Etappe 7: die Admin-Familie. Vorher gab es sie zweimal — Cache-Statistik,
  // Cache-Dauer, Preis-Job und der globale Standard-Zustand standen je einmal
  // unter /api/settings bzw. /api/finance und einmal unter /api/v1/admin.
  'GET /api/v1/admin/job-status': 'nur-v1',
  'POST /api/v1/admin/cache-clear': 'nur-v1',
  'POST /api/v1/admin/catalog-images': 'nur-v1',
  'POST /api/v1/settings/user/default-condition': 'nur-v1',
  // Etappe 5: zusammengelegt — es gibt nur noch die v1-Adresse, beide Clients
  // rufen sie auf (requireToken nimmt Sitzung ODER Token). Geprüft wird in
  // api-parity unter „eine Route, beide Ausweise".
  'GET /api/v1/finance/valuation': 'nur-v1',
  'GET /api/v1/finance/parts-valuation': 'nur-v1',
  'GET /api/v1/finance/minifigs-valuation': 'nur-v1',
  'GET /api/v1/finance/pnl': 'nur-v1',
  'GET /api/v1/finance/portfolio-history': 'nur-v1',
  'GET /api/v1/sets/:setNumber/price-history': 'nur-v1',
  'GET /api/v1/parts/:partNumber/:colorId/price-history': 'nur-v1',
  'GET /api/v1/minifigs/:figNumber/price-history': 'nur-v1',
  'GET /api/v1/': 'nur-v1',
  'GET /api/v1/auth/me': 'nur-v1',
  'POST /api/v1/auth/login': 'nur-v1',
  'POST /api/v1/auth/logout': 'nur-v1',
  'POST /api/v1/auth/token-create': 'nur-v1',
  'GET /api/v1/catalog/meta': 'nur-v1',
  'GET /api/v1/catalog/sets': 'nur-v1',
  'GET /api/v1/catalog/sets/:setNumber': 'nur-v1',
  // Sammelauflösung der BrickLink-Links für eine ganze Katalogseite (eine
  // SQL-Abfrage statt einer pro Set). Die Webapp ruft die v1-Katalogrouten
  // direkt auf, daher kein /api-Gegenstück nötig.
  'GET /api/v1/catalog/bricklink': 'nur-v1',
  // Diagnose: was antwortet das CDN, vom Server aus gesehen? Nur Admin,
  // kein Gegenstück in der Webapp-API nötig.
  // Passwort eines anderen Nutzers setzen — Administratorfunktion der Webapp.
  // Die Android-App hat keine Nutzerverwaltung, daher kein v1-Gegenstück.
  'PUT /api/auth/users/:id/password': 'nur-web',
  'GET /api/v1/admin/img-probe': 'nur-v1',
  // Dasselbe für Preise: Erfassungen, gewählter Zustand, Cache-Zeilen und
  // optional die Live-Antwort von BrickLink.
  'GET /api/v1/admin/price-probe': 'nur-v1',
  'GET /api/v1/sets/barcode/:barcode': 'nur-v1',
  'GET /api/v1/sets/:setNumber/parts-list': 'nur-v1',
  'GET /api/v1/sets/:setNumber/minifigs-list': 'nur-v1',
  'GET /api/v1/sets/:setNumber/price': 'nur-v1',
  'GET /api/v1/minifigs/:figNumber/parts': 'nur-v1',
  'POST /api/v1/sets/partslist-pdf': 'nur-v1',
  'GET /api/v1/sets/partslist-pdf/status/:jobId': 'nur-v1',
  'GET /api/v1/sets/partslist-pdf/stream/:jobId': 'nur-v1',
  'GET /api/v1/sets/partslist-pdf/download/:jobId': 'nur-v1',
  'PUT /api/v1/settings': 'nur-v1',
  'GET /api/v1/admin/api-limits': 'nur-v1',
  'PUT /api/v1/admin/api-limits': 'nur-v1',
  // Diagnose-Endpunkt (Nachtrag 50): beantwortet „warum fehlt das Bild für
  // Set X?" in einer Antwort. Bewusst nur in v1 — es ist ein Werkzeug für die
  // Fehlersuche, kein Teil der Oberfläche.
  'GET /api/v1/admin/image-diag/:setNumber': 'nur-v1',
  // Werkzeug für die Hand am Hebel — die Webapp braucht keine Entsprechung.
  'POST /api/v1/admin/forget-image-misses': 'nur-v1',
  'GET /api/v1/admin/brickset-queue': 'nur-v1',
  'DELETE /api/v1/admin/brickset-queue/:setNumber': 'nur-v1',
  'POST /api/v1/admin/brickset-queue/:setNumber/retry': 'nur-v1',
  'GET /api/v1/admin/cache-stats': 'nur-v1',
  'GET /api/v1/admin/cache-ttl': 'nur-v1',
  'POST /api/v1/admin/cache-ttl': 'nur-v1',
  'POST /api/v1/admin/default-condition': 'nur-v1',
  'GET /api/v1/admin/jobs': 'nur-v1',
  'POST /api/v1/admin/job-schedule': 'nur-v1',
  'GET /api/v1/admin/logs': 'nur-v1',
  'GET /api/v1/admin/users': 'nur-v1',
  'PUT /api/v1/admin/users/:id/role': 'nur-v1',
  // Preisverlauf manueller Teile und Minifiguren. Webapp-seitig; die
  // Android-App zeichnet dort (noch) kein Diagramm — deshalb kein v1-Gegenstück.
  // Seit hardened-96 gibt es beide auch für die Android-App — der
  // Detail-Dialog dort zeigte vorher weder Marktpreis je Zustand noch Verlauf.
  // Set in ein anderes Konto des Haushalts verschieben und die Kontoliste für
  // die Auswahl beim Erfassen. Beides bisher nur in der Webapp — die
  // Android-App bekommt sie, wenn die Haushaltssicht dort ankommt.
  
  'GET /api/v1/sets/household-members': 'paritaet',
  
  'POST /api/v1/sets/:sn/move': 'paritaet',
  // Haushalt: Konten verknüpfen. Beide Wege, damit die App dieselben Regeln
  // bekommt — die Grenzen (eine Stufe, gleiche Währung) stehen in
  // utils/household.ts, nicht in den Routen.
  'GET /api/v1/settings/household': 'nur-v1',
  'POST /api/v1/settings/household/invite': 'nur-v1',
  'POST /api/v1/settings/household/redeem': 'nur-v1',
  'POST /api/v1/settings/household/unlink': 'nur-v1',
  'POST /api/v1/admin/redownload-missing-images': 'nur-v1',
  'POST /api/v1/admin/reimport-instructions': 'nur-v1',
  'POST /api/v1/admin/trigger-csv-sync': 'nur-v1',
  'POST /api/v1/admin/trigger-price-job': 'nur-v1',

  // Nur Webapp
  'POST /api/auth/login': 'nur-web',
  'POST /api/auth/logout': 'nur-web',
  'POST /api/auth/register': 'nur-web',
  'GET /api/auth/registration-status': 'nur-web',
  'GET /api/auth/verify': 'nur-web',
  'GET /api/auth/me': 'nur-web',
  'GET /api/auth/profile': 'nur-web',
  'PUT /api/auth/profile': 'nur-web',
  'POST /api/auth/change-password': 'nur-web',
  'POST /api/auth/forgot-password': 'nur-web',
  'POST /api/auth/reset-password': 'nur-web',
  'GET /api/auth/check-token': 'nur-web',
  'GET /api/auth/qr-token': 'nur-web',
  'POST /api/auth/qr-login': 'nur-web',
  'GET /api/auth/users': 'nur-web',
  'POST /api/auth/users': 'nur-web',
  'DELETE /api/auth/users/:id': 'nur-web',
  'PUT /api/auth/users/:id/admin': 'nur-web',
  'GET /api/sets/info/:setNumber': 'nur-web',
  'POST /api/sets/add-stream': 'nur-web',
  'GET /api/sets/import/csv/status': 'nur-web',
  'GET /api/sets/import/csv/stream': 'nur-web',
  'POST /api/sets/import/csv': 'nur-web',
  'POST /api/sets/import/csv/cancel': 'nur-web',
  'GET /api/sets/export/csv': 'nur-web',
  'GET /api/sets/export/rebrickable': 'nur-web',
  'POST /api/sets/:setNumber/instructions': 'nur-web',
  'POST /api/sets/:setNumber/instructions/upload': 'nur-web',
  'DELETE /api/sets/:setNumber/instructions/:instrId': 'nur-web',
  'POST /api/sets/:setNumber/parts': 'nur-web',
  'GET /api/parts/categories': 'nur-web',
  'GET /api/parts/export/csv': 'nur-web',
  'POST /api/parts/import/csv': 'nur-web',
  'GET /api/minifigs/export/csv': 'nur-web',
  'POST /api/minifigs/import/csv': 'nur-web',
  'POST /api/settings': 'nur-web',
  'GET /api/settings/raw': 'nur-web',
  'GET /api/settings/export': 'nur-web',
  'GET /api/settings/export/data': 'nur-web',
  'POST /api/settings/import': 'nur-web',
  'GET /api/settings/tokens': 'nur-web',
  'DELETE /api/settings/tokens/:tokenId': 'nur-web',
  'GET /api/settings/theme': 'nur-web',
  'POST /api/settings/admin/theme': 'nur-web',
  'POST /api/settings/smtp-test': 'nur-web',
};

const VALID = new Set(['paritaet', 'paritaet-schreib', 'paar-extern', 'nur-v1', 'nur-web']);

test('jeder API-Endpunkt ist klassifiziert', () => {
  const eps = inventory();
  const missing = [...eps].filter(e => !(e in C)).sort();
  assert.deepEqual(missing, [],
    `Neue/unklassifizierte Endpunkte — bitte in test/api-inventory.test.js einordnen ` +
    `(und bei "paritaet" ein Paar in test/api-parity.test.js ergänzen):\n  ${missing.join('\n  ')}`);
});

test('keine verwaisten Klassifikations-Einträge', () => {
  const eps = inventory();
  const stale = Object.keys(C).filter(e => !eps.has(e)).sort();
  assert.deepEqual(stale, [],
    `Klassifizierte Endpunkte existieren nicht mehr:\n  ${stale.join('\n  ')}`);
});

test('nur gültige Kategorien', () => {
  const bad = Object.entries(C).filter(([, v]) => !VALID.has(v));
  assert.deepEqual(bad, []);
});
