/**
 * Vorberechnete Teile-Zusammenfassung (utils/partsSummary.ts).
 *
 * Die Teileansicht gruppiert 171'000 parts-Zeilen nach Teil und Farbe. Diese
 * Gruppierung lief bei JEDEM Seitenaufruf neu — auch nach der Umstellung auf
 * Endlos-Scroll, denn LIMIT greift erst nach dem GROUP BY. Gemessen an 380
 * Sets: 1294 ms bis zur ersten Kachel, rund 600 ms je Scroll-Schritt.
 * Aus der Zusammenfassung: 110 ms bzw. 5–13 ms.
 *
 * Der kritische Teil ist nicht die Geschwindigkeit, sondern dass die Zahlen
 * stimmen und nie veralten. Deshalb hängt die Entwertung an einem
 * Statement-Trigger auf `parts` und `sets` statt an Aufrufen in den
 * Schreibpfaden — kein Code-Pfad kann daran vorbei.
 *
 * Braucht Postgres (TEST_DATABASE_URL), überspringt sich sonst.
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// ── Statische Prüfungen (immer) ────────────────────────────────────────────
test('die Entwertung hängt an einem Trigger, nicht an Aufrufen', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'partsSummary.ts'), 'utf8');
  assert.match(src, /FOR EACH STATEMENT/,
    'Zeilen-Trigger würden bei einem CSV-Import 171 000 Mal feuern');
  for (const tbl of ['parts', 'sets']) {
    assert.match(src, new RegExp(`'${tbl}'`), `kein Trigger auf ${tbl}`);
  }
  assert.match(src, /bump_parts_version/, 'Versionszähler fehlt');

  // Der Zähler hängt JE KONTO — siehe den Test weiter unten. Ein globaler
  // Zähler (eine Zeile, id=1) entwertete die Zusammenfassung aller Konten,
  // sobald irgendjemand etwas schrieb.
  assert.match(src, /parts_version_user/, 'Der Zähler muss je Konto geführt werden');
  assert.doesNotMatch(src, /UPDATE parts_version SET v = v \+ 1 WHERE id = 1/,
    'Der globale Zähler entwertet fremde Zusammenfassungen mit');
  // Alle drei Operationen brauchen ihre eigene Übergangstabelle.
  for (const [op, ref] of [['INSERT', 'NEW TABLE AS neu'], ['DELETE', 'OLD TABLE AS alt'],
                           ['UPDATE', 'OLD TABLE AS alt NEW TABLE AS neu']]) {
    assert.ok(src.includes(ref), `${op}: Übergangstabelle fehlt (${ref})`);
  }
  // Beim UPDATE zählen BEIDE Seiten: Wandert eine Zeile im Haushalt zwischen
  // Konten, sind die Zusammenfassungen von Absender UND Ziel veraltet.
  assert.match(src, /SELECT user_id FROM alt UNION SELECT user_id FROM neu/,
    'Ein Kontowechsel muss beide Zusammenfassungen entwerten');
});

test('die Live-Abfrage bleibt als Rückfallebene erhalten', () => {
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(h, /if \(summary\) return summary;/,
    'Ohne Rückfall wäre ein Fehler beim Aufbau ein Totalausfall der Ansicht');
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'partsSummary.ts'), 'utf8');
  assert.match(src, /return false;/, 'ensureFresh muss Misserfolg melden können');
});

test('der set_number-Filter geht bewusst an der Zusammenfassung vorbei', () => {
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(h, /if \(excludesManual && !set_number\)/,
    'Die Teile EINES Sets sind ein anderer Anwendungsfall — dort ist die Live-Abfrage passend und schnell genug');
});

// ── Integrationstest (nur mit DB) ──────────────────────────────────────────
let db, H, PS, skip = null;
try {
  // Nach dist/ bauen statt in-place — siehe helpers/sources.js.
const _req = require('./helpers/sources').buildAndRequire();
  process.env.DATABASE_URL = DB_URL;
  process.env.SESSION_SECRET = 'test';
  db = _req('db/database.js');
  H  = require('./helpers/sources').handlerModul(_req);
  PS = _req('utils/partsSummary.js');
} catch (e) { skip = e.message; }

test('Zusammenfassung stimmt mit der Live-Abfrage überein und veraltet nicht',
  { skip: skip || undefined }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') {
      throw new Error(`REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar: ${DB_URL}`);
    }
    // REQUIRE_DB=1 (in CI gesetzt) verbietet das Überspringen.
    //
    // Ohne diese Sperre war die Suite in jeder Umgebung ohne Postgres GRÜN —
    // inklusive CI, falls der Service-Container mal nicht hochkommt. Genau
    // die Tests, die am meisten absichern, hätten dann stillschweigend nichts
    // geprüft. Lieber ein lauter Fehlschlag.
    if (process.env.REQUIRE_DB === '1') {
      throw new Error(`REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.`);
    }
    t.skip(`Test-DB nicht erreichbar (${DB_URL})`); return;
  }

  const U = 990501;
  const clean = async () => {
    await db.run('DELETE FROM parts WHERE user_id=$1', [U]);
    await db.run('DELETE FROM sets WHERE user_id=$1', [U]);
    await db.run('DELETE FROM parts_summary WHERE user_id=$1', [U]);
    await db.run('DELETE FROM parts_summary_state WHERE user_id=$1', [U]);
  };
  await clean();
  await db.run("INSERT INTO users (id,username,password_hash,is_admin) VALUES ($1,'psum','x',0) ON CONFLICT DO NOTHING", [U]);
  // Zwei Sets, das zweite doppelt vorhanden — die Menge muss mitmultipliziert werden.
  await db.run("INSERT INTO sets (user_id,set_number,quantity,condition) VALUES ($1,'A-1',1,'N'),($1,'B-1',2,'N')", [U]);
  await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,color_name,part_name,quantity,source)
    VALUES ($1,'A-1','3001',5,'Rot','Brick',3,'set'),
           ($1,'B-1','3001',5,'Rot','Brick',4,'set'),
           ($1,'A-1','3002',1,'Blau','Plate',1,'set')`, [U]);

  // Seit dem Fix baut ensureFresh() NICHT mehr im Request auf. Der erste
  // Zugriff eines Nutzers ohne Zusammenfassung wird deshalb aus der
  // Live-Abfrage bedient, während der Aufbau im Hintergrund anläuft. Für die
  // Inhaltsprüfung hier wird einmal explizit aufgebaut.
  const first = await H.getParts(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(first.source, 'db',
    'ohne vorhandene Zusammenfassung muss die Live-Abfrage einspringen statt zu warten');
  await PS.rebuildNow(U);

  const r1 = await H.getParts(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(r1.source, 'summary', 'die Zusammenfassung wurde nicht benutzt');
  assert.equal(r1.total, 2, 'zwei Teil/Farb-Gruppen erwartet');
  const rot = r1.parts.find(p => p.color_name === 'Rot');
  assert.equal(rot.total_quantity, 3 * 1 + 4 * 2,
    'die Set-Menge muss in die Teilemenge eingehen');

  // Änderung an parts → Trigger → nächster Lesezugriff baut neu auf
  await db.run(`INSERT INTO parts (user_id,set_number,part_number,color_id,color_name,part_name,quantity,source)
                VALUES ($1,'A-1','3003',2,'Gelb','Tile',9,'set')`, [U]);
  // Der Lesezugriff darf jetzt NICHT mehr blockieren: Er liefert den alten
  // Stand und stösst den Aufbau nur an. Erst danach stimmen die Zahlen wieder.
  const stale = await H.getParts(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(stale.total, 2, 'der Lesezugriff soll den alten Stand liefern, nicht warten');
  await PS.rebuildNow(U);
  const r2 = await H.getParts(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(r2.total, 3, 'nach dem Aufbau muss die neue Gruppe enthalten sein');

  // Änderung an sets → ebenfalls
  await db.run("UPDATE sets SET quantity=3 WHERE user_id=$1 AND set_number='B-1'", [U]);
  await PS.rebuildNow(U);
  const r3 = await H.getParts(U, { exclude_manual: '1', page: 1, page_size: 50 });
  const rot3 = r3.parts.find(p => p.color_name === 'Rot');
  assert.equal(rot3.total_quantity, 3 * 1 + 4 * 3,
    'eine geänderte Set-Menge muss durchschlagen');

  // ── Der Schreibvorgang eines FREMDEN Kontos darf nichts entwerten ────────
  //
  // Vorher zählte ein einziger globaler Zähler: Trug ein Kind ein Teil nach,
  // galt die Zusammenfassung der Eltern als veraltet, und die Kennzahlen
  // (strict) wichen bis zum Abschluss des Neuaufbaus auf die Live-Abfrage aus
  // — an 800 Sets / 60'000 Teilen rund 300 ms, ausgelöst von einer Änderung,
  // die mit diesen Daten nichts zu tun hat.
  const FREMD = 990502;
  await db.run("INSERT INTO users (id,username,password_hash,is_admin) VALUES ($1,'psum2','x',0) ON CONFLICT DO NOTHING", [FREMD]);
  await PS.rebuildNow(U);
  assert.equal(await PS.ensureFresh(U, { strict: true }), true,
    'Vorbedingung: die eigene Zusammenfassung ist frisch');
  await db.run(`INSERT INTO parts (user_id,part_number,color_id,color_name,part_name,quantity,source)
                VALUES ($1,'9999',7,'Grün','Fremd',1,'manual')`, [FREMD]);
  assert.equal(await PS.ensureFresh(U, { strict: true }), true,
    'Ein fremdes Konto darf die eigene Zusammenfassung nicht entwerten');
  // Die eigene Änderung dagegen schon.
  await db.run("UPDATE sets SET quantity=quantity WHERE user_id=$1 AND set_number='A-1'", [U]);
  assert.equal(await PS.ensureFresh(U, { strict: true }), false,
    'Eine eigene Änderung muss die Zusammenfassung entwerten');
  await db.run('DELETE FROM parts WHERE user_id=$1', [FREMD]);
  await PS.rebuildNow(U);

  // Statistik und Farbfilter kommen aus derselben Quelle
  const stats = await H.getPartsStats(U);
  assert.equal(stats.unique_parts, 3);
  const colors = await H.getPartsColors(U);
  assert.equal(colors.length, 3);

  // Seitengrenzen
  const p1 = await H.getParts(U, { exclude_manual: '1', page: 1, page_size: 2 });
  const p2 = await H.getParts(U, { exclude_manual: '1', page: 2, page_size: 2 });
  assert.equal(p1.parts.length, 2);
  assert.equal(p2.parts.length, 1);
  assert.equal(p1.total, 3, 'total muss die Gesamtzahl sein, nicht die der Seite');

  await clean();
  await db.run('DELETE FROM users WHERE id=$1', [U]);
});

test('der Neuaufbau blockiert den Request nicht', () => {
  // Kern des zuletzt gemeldeten Fehlers: ensureFresh() hat bei veralteter
  // Version SYNCHRON neu aufgebaut. Weil der Trigger die Version bei jeder
  // Änderung an parts hochsetzt (CSV-Import, Set hinzufügen,
  // Katalog-Anreicherung), zahlte der nächste Aufruf des Teile-Reiters den
  // vollen Aufbau — an 380 Sets gemessen gut drei Sekunden, in denen die
  // Kachelwand leer blieb. Manuell erfasste Teile erschienen sofort, weil sie
  // über eine eigene Abfrage ohne Zusammenfassung laufen.
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'partsSummary.ts'), 'utf8');
  const fn = src.slice(src.indexOf('export async function ensureFresh'),
                       src.indexOf('export async function rebuildNow'));
  assert.ok(fn.length > 0, 'ensureFresh nicht gefunden');
  assert.doesNotMatch(fn, /await rebuild\(/,
    'ensureFresh darf nicht im Request aufbauen — genau das waren die drei Sekunden');
  assert.match(fn, /rebuildInBackground\(/, 'Der Aufbau muss in den Hintergrund');
  assert.match(fn, /return !!state/,
    'Veralteter Stand wird ausgeliefert; ohne jeden Stand übernimmt die Live-Abfrage');

  assert.match(src, /const _rebuilding = new Map/,
    'Ohne Sperre starten parallele Anfragen denselben Aufbau mehrfach');
  assert.match(src, /export async function rebuildNow/,
    'Für Stellen, die garantiert aktuelle Zahlen brauchen, muss es einen blockierenden Weg geben');
});

test('Kennzahlen benutzen keinen veralteten Stand', () => {
  // Webapp und Android fragen dieselbe Statistik über zwei Endpunkte ab.
  // Während eines Hintergrund-Neuaufbaus las der eine aus der Zusammenfassung
  // und der andere live — die Paritätsprüfung schlug dadurch reproduzierbar
  // fehl. Mit strict weichen beide gemeinsam auf die Live-Abfrage aus.
  const ps = fs.readFileSync(path.join(ROOT, 'utils', 'partsSummary.ts'), 'utf8');
  assert.match(ps, /opts\?: \{ strict\?: boolean \}/, 'strict-Variante fehlt');
  assert.match(ps, /if \(opts\?\.strict\) return false;/,
    'Ein veralteter Stand muss unter strict abgelehnt werden');

  const h = require('./helpers/sources').handlerQuelle();
  // Seit der Haushaltssicht bekommt der Helfer eine LISTE von Konten (uids)
  // und prüft jedes einzeln; strict gilt unverändert.
  assert.match(h, /await ensureFresh\(uids, \{ strict: true \}\)/,
    'getPartsStats muss strict aufrufen');
  // Die Liste darf weiterhin den veralteten Stand nehmen — dort ist es egal
  assert.match(h, /tryPartsSummary\(userId/, 'Der Listenpfad bleibt unverändert');
});

// Verbindungspool schliessen — sonst bleibt der Testprozess nach dem letzten
// Test hängen und der Läufer meldet die Datei als fehlgeschlagen, obwohl jede
// Prüfung grün war. Ohne erreichbare Datenbank fiel das nie auf: Dann wurde
// gar keine Verbindung geöffnet.
test('Verbindungen schliessen', async () => {
  await db.pool.end().catch(() => {});
});
