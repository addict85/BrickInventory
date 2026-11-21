/**
 * API inventory: EVERY endpoint of both router families must be classified
 * here. The test parses the route files; if a new endpoint appears that is
 * missing here, the suite turns red — so no API can be added unchecked/undocu-
 * mented anymore. Conversely, orphaned entries report removed routes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { routerEinhaengungen } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');

function scan(file, mount) {
  const src = fs.readFileSync(file, 'utf8');
  return require('./helpers/sources')
    .routesFromSource(src, mount)
    .filter(m => m[1] !== 'patch')
    .map(m => [m[1].toUpperCase(), m[2]]);
}

function inventory() {
  const eps = new Set();
  // Mount points READ from server.ts instead of copied: a
  // copied list silently goes stale. See routerEinhaengungen().
  for (const r of routerEinhaengungen())
    for (const [m, p] of scan(r.datei, r.mount)) eps.add(`${m} ${r.mount}${p === '/' ? '' : p}`);
  for (const f of fs.readdirSync(path.join(ROOT, 'routes/api_v1')))
    if (f.endsWith('.ts') && !['index.ts', 'middleware.ts'].includes(f))
      for (const [m, p] of scan(path.join(ROOT, 'routes/api_v1', f), '/api/v1')) eps.add(`${m} /api/v1${p}`);
  return eps;
}

// ── Complete classification (state: see test error message on drift) ───────
const C = {
  // Read parity pairs (api-parity.test.js, PAIRS)
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
  'GET /api/v1/settings': 'paritaet',
  'GET /api/v1/sets/:setNumber/acquisitions': 'paritaet',
  'GET /api/v1/parts/:partNumber/:colorId/acquisitions': 'paritaet',
  'GET /api/v1/minifigs/:figNumber/acquisitions': 'paritaet',

  // Write parity pairs (api-parity.test.js, effect comparison)
  'PUT /api/v1/sets/:setNumber': 'paritaet-schreib',
  'DELETE /api/v1/sets/:setNumber': 'paritaet-schreib',
  'PUT /api/v1/sets/:setNumber/acquisitions/:acqId': 'paritaet-schreib',

  // Pairs with external API calls — parity not checkable automatically
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

  // Only /api/v1 — used by both clients (or only Android)
  // Stage 6: merged — only the v1 address remains, both clients call
  // it. The condition resolution itself is in src/settings/settings.ts.
  'GET /api/v1/stats': 'nur-v1',
  'GET /api/v1/settings/default-condition': 'nur-v1',
  'GET /api/v1/settings/user/default-condition': 'nur-v1',
  'GET /api/v1/minifigs/stats': 'nur-v1',
  'GET /api/v1/sets/exists/:setNumber': 'nur-v1',
  'GET /api/v1/catalog/year-verteilung': 'nur-v1',
  // Stage 7: the admin family. Previously it existed twice — cache statistics,
  // cache duration, price job and the global default condition were each once
  // under /api/settings or /api/finance and once under /api/v1/admin.
  'GET /api/v1/admin/job-status': 'nur-v1',
  // The job table in the administration (“background jobs"): web app and
  // app (monitoring, VerwaltungApi.getAuftraege) both call it.
  'GET /api/v1/admin/auftraege': 'nur-v1',
  'POST /api/v1/admin/auftraege/:id/abbrechen': 'nur-v1',
  'POST /api/v1/admin/auftraege/:id/wiederholen': 'nur-v1',
  'POST /api/v1/admin/auftraege/art/:art/jetzt': 'nur-v1',
  'DELETE /api/v1/admin/auftraege/art/:art': 'nur-v1',
  'POST /api/v1/admin/cache-clear': 'nur-v1',
  'POST /api/v1/admin/catalog-images': 'nur-v1',
  'POST /api/v1/settings/user/default-condition': 'nur-v1',
  // Stage 5: merged — only the v1 address remains, both clients
  // call it (requireToken takes session OR token). Checked in
  // api-parity under “one route, both credentials".
  'GET /api/v1/finance/valuation': 'nur-v1',
  'GET /api/v1/finance/parts-valuation': 'nur-v1',
  'GET /api/v1/finance/minifigs-valuation': 'nur-v1',
  'GET /api/v1/finance/pnl': 'nur-v1',
  'GET /api/v1/finance/portfolio-history': 'nur-v1',
  'GET /api/v1/sets/:setNumber/price-history': 'nur-v1',
  'GET /api/v1/parts/:partNumber/:colorId/price-history': 'nur-v1',
  'GET /api/v1/minifigs/:figNumber/price-history': 'nur-v1',
  // Detail dialog for parts/minifigures FROM SETS: which sets
  // use this part? Both go through THE SAME function
  // (usingSets in src/inventory/shared.ts) — the old UI never
  // had anything for it, so there is no counterpart to pair.
  'GET /api/v1/parts/:partNumber/:colorId/sets': 'nur-v1',
  'GET /api/v1/minifigs/:figNumber/sets': 'nur-v1',
  'GET /api/v1/': 'nur-v1',
  'GET /api/v1/auth/me': 'nur-v1',
  'POST /api/v1/auth/login': 'nur-v1',
  'POST /api/v1/auth/logout': 'nur-v1',
  'POST /api/v1/auth/token-create': 'nur-v1',
  'POST /api/v1/auth/qr-login': 'nur-v1',
  'POST /api/v1/auth/qr-login/abholen': 'nur-v1',
  'POST /api/v1/auth/qr-login/verwerfen': 'nur-v1',
  // Before a plain-text access the app asks whether the server knows its token.
  // Exchange of the own token: a path of the app (rotation).
  'POST /api/v1/auth/token-rotieren': 'nur-v1',
  // Step-up protection of the app: keystore key and approval; the browser confirms with password.
  'POST /api/v1/geraet/schluessel': 'nur-v1',
  'POST /api/v1/geraet/schluessel/nonce': 'nur-v1',
  'POST /api/v1/geraet/schritt/challenge': 'nur-v1',
  'POST /api/v1/geraet/schritt/freigabe': 'nur-v1',
  // Passkeys are WebAuthn in the browser; login creates a session.
  'GET /api/v1/auth/passkeys': 'nur-web',
  'DELETE /api/v1/auth/passkeys/:id': 'nur-web',
  'POST /api/v1/auth/passkey/registrieren/optionen': 'nur-web',
  'POST /api/v1/auth/passkey/registrieren': 'nur-web',
  'POST /api/v1/auth/passkey/anmelden/optionen': 'nur-v1',
  'POST /api/v1/auth/passkey/anmelden': 'nur-v1',
  // Fingerprint of the CA for manual comparison; the app gets it in the QR code.
  'GET /api/v1/settings/tls': 'nur-web',
  // Signed-in devices: called by BOTH apps since the token administration.
  // Were listed as 'nur-web' and never were — there was no caller
  // at all, and the routes hung behind requireLogin (session-bound),
  // so they were not reachable for the app at all.
  'GET /api/v1/settings/tokens': 'nur-v1',
  'DELETE /api/v1/settings/tokens/:tokenId': 'nur-v1',
  'POST /api/v1/settings/sessions/andere-beenden': 'nur-v1',
  'GET /api/v1/catalog/meta': 'nur-v1',
  'GET /api/v1/catalog/sets': 'nur-v1',
  'GET /api/v1/catalog/sets/:setNumber': 'nur-v1',
  // Bulk resolution of the BrickLink links for a whole catalog page (one
  // SQL query instead of one per set). The web app calls the v1 catalog routes
  // directly, hence no /api counterpart needed.
  'GET /api/v1/catalog/bricklink': 'nur-v1',
  // Diagnosis: what does the CDN answer, seen from the server? Admin only,
  // no counterpart needed in the web app API.
  // Set another user's password — administrator function of the web app.
  // The Android app has no user administration, hence no v1 counterpart.
  'PUT /api/v1/auth/users/:id/password': 'nur-web',
  'POST /api/v1/admin/img-probe': 'nur-v1',
  // The same for prices: entries, selected condition, cache rows and
  // optionally the live response from BrickLink.
  'POST /api/v1/admin/price-probe': 'nur-v1',
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
  // Diagnosis endpoint: answers “why is the image missing for
  // set X?" in one response. Deliberately only in v1 — it is a tool for
  // debugging, not part of the UI.
  'GET /api/v1/admin/image-diag/:setNumber': 'nur-v1',
  // A tool for the hand on the lever — the web app needs no equivalent.
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
  // Price history of manual parts and minifigures. Web app side; the
  // Android app draws no chart there (yet) — hence no v1 counterpart.
  // Since hardened-96 both also exist for the Android app — the
  // detail dialog there previously showed neither market price per condition nor history. …

  'GET /api/v1/sets/household-members': 'paritaet',

  'POST /api/v1/sets/:sn/move': 'paritaet',
  // Household: link accounts. Both paths, so that the app gets the same rules
  // — the limits (no cycle, same currency in the whole
  // joining subtree) are in src/household/household.ts, not in the
  // routes. “Only one level” stood here until an earlier round.
  'GET /api/v1/settings/household': 'nur-v1',
  'POST /api/v1/settings/household/invite': 'nur-v1',
  'POST /api/v1/settings/household/redeem': 'nur-v1',
  'POST /api/v1/settings/household/redeem/pruefen': 'nur-web',
  'POST /api/v1/settings/household/unlink': 'nur-v1',
  'POST /api/v1/settings/household/former/dismiss': 'nur-v1',
  'POST /api/v1/admin/redownload-missing-images': 'nur-v1',
  'POST /api/v1/admin/reimport-instructions': 'nur-v1',
  'POST /api/v1/admin/trigger-csv-sync': 'nur-v1',
  'POST /api/v1/admin/trigger-price-job': 'nur-v1',

  // Both clients, formerly only the web app
  'DELETE /api/v1/sets/:setNumber/instructions/:instrId': 'nur-v1',
  'GET /api/v1/auth/profile': 'nur-v1',
  'GET /api/v1/auth/registration-status': 'nur-v1',
  'GET /api/v1/parts/categories': 'nur-v1',
  'GET /api/v1/sets/import/csv/status': 'nur-v1',
  'GET /api/v1/sets/import/csv/stream': 'nur-v1',
  'GET /api/v1/settings/theme': 'nur-v1',
  'POST /api/v1/auth/change-password': 'nur-v1',
  'POST /api/v1/auth/forgot-password': 'nur-v1',
  'POST /api/v1/auth/bestaetigung-erneut': 'nur-v1',
  'POST /api/v1/auth/email-bestaetigen': 'nur-v1',
  'POST /api/v1/auth/email-bestaetigen/vorschau': 'nur-v1',
  'POST /api/v1/auth/register': 'nur-v1',
  'POST /api/v1/minifigs/import/csv': 'nur-v1',
  // “Can I build this?” — both UIs call it,
  // there never was a second version under /api.
  'POST /api/v1/parts/owned': 'nur-v1',
  // Storage location — both UIs, never a second version
  // under /api. GET /storage spans sets AND parts and therefore belongs to
  // neither of the two families alone.
  // Price alert — both UIs. Without account filter: a …
  'GET /api/v1/alerts/pending': 'nur-v1',
  // The OVERVIEW of all alerts — both UIs. Deliberately separate
  // from /alerts/pending: those are two questions. `pending` is fleeting (“what
  // has triggered since my last fetch?"), this one is complete
  // (“what have I set?"). Writing still goes via the route to the
  // set — the overview gets no write path of its own.
  'GET /api/v1/alerts': 'nur-v1',
  'GET /api/v1/sets/:setNumber/alert': 'nur-v1',
  'PUT /api/v1/sets/:setNumber/alert': 'nur-v1',
  'DELETE /api/v1/sets/:setNumber/alert': 'nur-v1',
  'GET /api/v1/storage': 'nur-v1',
  // The STOCK of storage locations — Marco's select field. Separate
  // from GET /storage above: the one says what is OCCUPIED (filter), the
  // other what is available to CHOOSE (select field and settings).
  'GET /api/v1/storage/locations': 'nur-v1',
  'POST /api/v1/storage/locations': 'nur-v1',
  'PUT /api/v1/storage/locations/:id': 'nur-v1',
  'DELETE /api/v1/storage/locations/:id': 'nur-v1',
  // Marco's star: the storage location already preselected when adding.
  // Both UIs set it (web app: settings, app: LagerorteCard),
  // both read it from the response of GET /storage/locations — hence
  // nur-v1 and no read path of its own.
  'PUT /api/v1/storage/default': 'nur-v1',
  // The wishlist — Marco's “what one would like to have", separate
  // from ownership. nur-v1 and not paritaet: both UIs call the same
  // addresses, so there is no second counterpart to compare at all.
  // The rules behind it are checked by test/wanted-db.test.js against the DB.
  'GET /api/v1/wanted': 'nur-v1',
  'POST /api/v1/wanted': 'nur-v1',
  'DELETE /api/v1/wanted/:setNumber/:condition': 'nur-v1',
  'POST /api/v1/wanted/:setNumber/:condition/uebernehmen': 'nur-v1',
  'POST /api/v1/wanted/import/csv': 'nur-v1',
  'POST /api/v1/alerts/import/csv': 'nur-v1',
  'POST /api/v1/wanted-list/import/xml': 'nur-web',
  // Own design of the account: web app profile and account screen of the app.
  'POST /api/v1/settings/user/theme': 'nur-v1',

  // Vouchers
  'GET /api/v1/vouchers': 'nur-v1',
  'POST /api/v1/vouchers': 'nur-v1',
  'POST /api/v1/vouchers/pdf': 'nur-v1',
  'GET /api/v1/vouchers/export/pdf': 'nur-v1',
  'PUT /api/v1/vouchers/:id': 'nur-v1',
  'DELETE /api/v1/vouchers/:id': 'nur-v1',
  // Query the balance at LEGO. 'nur-v1' like the other voucher paths:
  // both UIs call them, there is no old address beside them.
  'POST /api/v1/vouchers/:id/guthaben': 'nur-v1',
  // Plain text of number and PIN, confirmed and logged; the list only shows the mask.
  'POST /api/v1/vouchers/:id/klartext': 'nur-v1',
  // One-time ticket for the PDF fetches (confirmed, logged, 60 s, one fetch).
  'POST /api/v1/vouchers/:id/pdf-freigabe': 'nur-v1',
  'POST /api/v1/vouchers/export/pdf-freigabe': 'nur-v1',
  // The PDF outputs (single and export) are not called by the Android app via Retrofit but via
  // the address in PdfViewerScreen (the same signed-in OkHttpClient). For
  // this inventory that is the same case: one implementation, both apps.
  'GET /api/v1/vouchers/:id/pdf': 'nur-v1',
  // State of the initial setup before login (public/js/setup-status.js).
  // Only the web app shows it; the app has its own setup.
  'GET /api/v1/einrichtung/stand': 'nur-web',
  // Setup wizard (public/js/setup.js).
  'GET /api/v1/settings/einrichtung': 'nur-v1',
  'POST /api/v1/settings/einrichtung/fertig': 'nur-v1',
  'POST /api/v1/settings/quelle-testen': 'nur-v1',
  // Second factor (src/factors/secondFactor.ts): only under v1, no old path.
  'GET /api/v1/auth/zweiter-faktor': 'nur-v1',
  'POST /api/v1/auth/zweiter-faktor/einrichten': 'nur-v1',
  'POST /api/v1/auth/zweiter-faktor/bestaetigen': 'nur-v1',
  'POST /api/v1/auth/zweiter-faktor/abschalten': 'nur-v1',
  'POST /api/v1/auth/zweiter-faktor/codes': 'nur-v1',
  'DELETE /api/v1/auth/users/:id/zweiter-faktor': 'nur-v1',
  // Trash (src/inventory/trash.ts): only under v1, no old path beside it.
  'GET /api/v1/papierkorb': 'nur-v1',
  'POST /api/v1/papierkorb/:id/wiederherstellen': 'nur-v1',
  'DELETE /api/v1/papierkorb/:id': 'nur-v1',
  'DELETE /api/v1/papierkorb': 'nur-v1',
  'DELETE /api/v1/bestand': 'nur-v1',
  // The owner change (Marco's “the owner cannot be changed on the detail
  // dialog"). Also nur-v1: both UIs call the same
  // address. The rule behind it — date added stays, price alert moves along,
  // a wishlist item the target already has is merged — is checked by
  // test/wanted-db.test.js against the database.
  'PUT /api/v1/wanted/:setNumber/:condition/inhaber': 'nur-v1',
  // The market prices of a wishlist item. Own address because /sets/:sn/price answers
  // 404 if the set does not belong to one — rationale at the route.
  'GET /api/v1/wanted/:setNumber/preise': 'nur-v1',
  'PUT /api/v1/parts/:partNumber/:colorId/storage': 'nur-v1',
  // Change the color of a manually entered part afterwards (Marco's
  // ask from 19.10., after importing several wanted lists). nur-v1 like the
  // storage location above: both UIs call the same address, a
  // session equivalent does not exist. What it DOES — moving or …
  'PUT /api/v1/parts/:partNumber/:colorId/color': 'nur-v1',
  'PUT /api/v1/sets/:setNumber/storage': 'nur-v1',
  // Since migration 0024 a minifigure also carries a storage location. Same
  // form and same reason as the two lines above: the web app sets
  // it via the v1 address, a session equivalent does not exist.
  'PUT /api/v1/minifigs/:figNumber/storage': 'nur-v1',
  'POST /api/v1/parts/import/csv': 'nur-v1',
  'POST /api/v1/sets/:setNumber/instructions/upload': 'nur-v1',
  'POST /api/v1/sets/add-stream': 'nur-v1',
  'POST /api/v1/sets/import/csv': 'nur-v1',
  'POST /api/v1/sets/import/csv/cancel': 'nur-v1',
  'POST /api/v1/settings/admin/theme': 'nur-v1',
  'PUT /api/v1/auth/profile': 'nur-v1',
  // And since an earlier round this one too: the app's parts list fetches the set name
  // here now instead of via /sets/{nr}. The difference is not formal — the
  // detail searches in the own view and answers 404 for a foreign set,
  // and in the parts list foreign sets are the norm.
  'GET /api/v1/sets/info/:setNumber': 'nur-v1',

  // Web app only
  'POST /api/v1/auth/reset-password': 'nur-web',
  // Links from mails to the owner (cancel announcement, approve login).
  'POST /api/v1/auth/uebernahme-abbrechen': 'nur-web',
  'POST /api/v1/auth/anmeldung-freigeben': 'nur-web',
  // switched from GET to POST — the route CREATES a
  // login nonce and as GET was the only state-changing route
  // that SameSite=lax let through.
  'POST /api/v1/auth/qr-token': 'nur-web',
  'GET /api/v1/auth/qr-kopplung/:id': 'nur-web',
  'POST /api/v1/auth/qr-kopplung/:id/bestaetigen': 'nur-web',
  'POST /api/v1/auth/qr-kopplung/:id/ablehnen': 'nur-web',
  'GET /api/v1/auth/users': 'nur-web',
  'POST /api/v1/auth/users': 'nur-web',
  'DELETE /api/v1/auth/users/:id': 'nur-web',
  // Delete the own account: final, with password and second factor; deliberately only in the web app.
  'DELETE /api/v1/auth/konto': 'nur-web',
  'PUT /api/v1/auth/users/:id/admin': 'nur-web',
  'PUT /api/v1/auth/users/:id/aktiv': 'nur-web',
  'PUT /api/v1/auth/users/:id/freischalten': 'nur-web',
  'GET /api/v1/admin/protokoll': 'nur-web',
  'GET /api/v1/sets/export/rebrickable': 'nur-web',
  // Both were “nur-web" because the app did not know them — and
  // that was a gap, not a decision. The web app has always offered “search
  // instructions again" and “reread parts" in the set detail; a set
  // added before its catalog entry stayed in the app permanently
  // at 0 parts. Now both UIs call them.
  'POST /api/v1/sets/:setNumber/instructions': 'nur-v1',
  'POST /api/v1/sets/:setNumber/parts': 'nur-v1',
  'POST /api/v1/settings': 'nur-web',
  'GET /api/v1/settings/raw': 'nur-web',
  'GET /api/v1/settings/export': 'nur-web',
  'GET /api/v1/settings/export/data': 'nur-web',
  'POST /api/v1/settings/import': 'nur-web',
  'POST /api/v1/settings/smtp-test': 'nur-web',
  // Before login and for monitoring/compose.yaml (routes/health.ts).
  'GET /api/v1/startup-status': 'nur-v1',
  'GET /api/v1/health': 'nur-v1',
  'GET /api/v1/health/live': 'nur-v1',
  'GET /api/v1/health/ready': 'nur-v1',
};

const VALID = new Set(['paritaet', 'paritaet-schreib', 'paar-extern', 'nur-v1', 'nur-web']);

test('every API endpoint is classified', () => {
  const eps = inventory();
  const missing = [...eps].filter(e => !(e in C)).sort();
  assert.deepEqual(
    missing,
    [],
    `Neue/unklassifizierte Endpunkte — bitte in test/api-inventory.test.js einordnen ` +
      `(und bei "paritaet" ein Paar in test/api-parity.test.js ergänzen):\n  ${missing.join('\n  ')}`,
  );
});

test('no orphaned classification entries', () => {
  const eps = inventory();
  const stale = Object.keys(C)
    .filter(e => !eps.has(e))
    .sort();
  assert.deepEqual(stale, [], `Klassifizierte Endpunkte existieren nicht mehr:\n  ${stale.join('\n  ')}`);
});

/** Every address the Android app calls (shared/app-schnittstelle.json). */
function androidAddresses() {
  const { routen, adressen } = require('./helpers/contract').appSchnittstelle();
  const gefunden = new Set(routen.map(r => `${r.methode} ${comparable(r.pfad)}`));
  // Built by hand: the method is not given, so under all verbs. That can relieve
  // one address too many, but wrongly accuse none.
  for (const a of adressen)
    for (const v of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) gefunden.add(`${v} ${comparable(a)}`);
  return gefunden;
}

/** Retrofit writes `{x}` and omits the slash, Express takes `:x`. */
function comparable(p) {
  return ('/' + p.trim().replace(/^\/+|\/+$/g, '')).replace(/\{[^}]+\}/g, ':X').replace(/:[A-Za-z_]\w*/g, ':X');
}

test('no "nur-web" is in truth called by the Android app', () => {
  const app = androidAddresses();
  // Self-proof: if the pattern no longer matches, the set would be empty and the
  // test green without having checked anything. MEASURED there are over 90.
  assert.ok(app.size >= 80, `Nur ${app.size} Android-Adressen gefunden — Muster veraltet?`);

  const falsch = Object.entries(C)
    .filter(([, k]) => k === 'nur-web')
    .map(([e]) => {
      const [verb, pfad] = e.split(' ');
      return app.has(`${verb} ${comparable(pfad)}`) ? e : null;
    })
    .filter(Boolean)
    .sort();

  assert.deepEqual(
    falsch,
    [],
    'Diese Endpunkte sind als „nur-web" eingetragen, die Android-App ruft sie aber:\n  ' +
      falsch.join('\n  ') +
      '\nEntweder die Beschriftung ist veraltet (dann auf nur-v1 setzen), oder der ' +
      'Aufruf in der App gehoert dort nicht hin.',
  );
});

test('only valid categories', () => {
  const bad = Object.entries(C).filter(([, v]) => !VALID.has(v));
  assert.deepEqual(bad, []);
});
