/**
 * Vorberechnete Teile-Zusammenfassung (src/teile/partsSummary.ts).
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const { umgebung } = require('./helpers/sources');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { haeltSet, haeltTeil } = require('./helpers/bestand');
const { keineDb } = require('./helpers/db');

const ROOT = path.join(__dirname, '..');
const DB_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// ── Statische Prüfungen (immer) ────────────────────────────────────────────
test('die Entwertung hängt an einem Trigger, nicht an Aufrufen', () => {
  // Die Trigger stehen seit 0052 in einer Migration, nicht mehr im Code.
  const src = fs.readFileSync(path.join(ROOT, 'db/migrations/0052-teilezusammenfassung-stand.sql'), 'utf8');
  assert.match(src, /FOR EACH STATEMENT/, 'Zeilen-Trigger würden bei einem CSV-Import 171 000 Mal feuern');
  for (const tbl of ['parts', 'sets']) {
    assert.match(src, new RegExp(`'${tbl}'`), `kein Trigger auf ${tbl}`);
  }
  assert.match(src, /bump_parts_version/, 'Versionszähler fehlt');

  // Der Zähler hängt JE KONTO — siehe den Test weiter unten. Ein globaler
  // Zähler (eine Zeile, id=1) entwertete die Zusammenfassung aller Konten,
  // sobald irgendjemand etwas schrieb.
  assert.match(src, /parts_version_user/, 'Der Zähler muss je Konto geführt werden');
  assert.doesNotMatch(
    src,
    /UPDATE parts_version SET v = v \+ 1 WHERE id = 1/,
    'Der globale Zähler entwertet fremde Zusammenfassungen mit',
  );
  // Alle drei Operationen brauchen ihre eigene Übergangstabelle.
  for (const [op, ref] of [
    ['INSERT', 'NEW TABLE AS neu'],
    ['DELETE', 'OLD TABLE AS alt'],
    ['UPDATE', 'OLD TABLE AS alt NEW TABLE AS neu'],
  ]) {
    assert.ok(src.includes(ref), `${op}: Übergangstabelle fehlt (${ref})`);
  }
  // Beim UPDATE zählen BEIDE Seiten: Wandert eine Zeile im Haushalt zwischen
  // Konten, sind die Zusammenfassungen von Absender UND Ziel veraltet.
  assert.match(
    src,
    /SELECT user_id FROM alt UNION SELECT user_id FROM neu/,
    'Ein Kontowechsel muss beide Zusammenfassungen entwerten',
  );
});

test('die Live-Abfrage bleibt als Rückfallebene erhalten', () => {
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(
    h,
    /if \(summary\) return summary;/,
    'Ohne Rückfall wäre ein Fehler beim Aufbau ein Totalausfall der Ansicht',
  );
  const src = fs.readFileSync(path.join(ROOT, 'src/teile/partsSummary.ts'), 'utf8');
  assert.match(src, /return false;/, 'ensureFresh muss Misserfolg melden können');
});

test('set_number und storage gehen bewusst an der Zusammenfassung vorbei', () => {
  // Zwei Filter, ein Grund: Die Zusammenfassung ist nach Teil und Farbe
  // verdichtet und kann nach nichts filtern, was INNERHALB einer Gruppe
  // verschieden ist.
  const h = require('./helpers/sources').handlerQuelle();
  const zeile = /if \(filter\.ohneManuelle && ([^)]*)\)/.exec(h)?.[1] || '';
  assert.ok(
    zeile.includes('!filter.set_number'),
    'Die Teile EINES Sets sind ein anderer Anwendungsfall — dort ist die Live-Abfrage passend und schnell genug',
  );
  assert.ok(
    zeile.includes('!filter.storage'),
    'Der Lagerort steht in der Zusammenfassung nur verdichtet — ein Filter darauf träfe die Gruppe falsch',
  );
});

// ── Integrationstest (nur mit DB) ──────────────────────────────────────────
let db,
  H,
  PS,
  S,
  skip = null;
try {
  // Nach dist/ bauen statt in-place — siehe helpers/sources.js.
  const _req = require('./helpers/sources').buildAndRequire();
  process.env.DATABASE_URL = DB_URL;
  umgebung({ SESSION_SECRET: 'test' });
  db = _req('db/database.js');
  H = require('./helpers/sources').handlerModul(_req);
  PS = _req('src/teile/partsSummary.js');
  S = _req('src/bestand/kennzahlen.js');
} catch (e) {
  skip = e.message;
}

test('Zusammenfassung stimmt mit der Live-Abfrage überein und veraltet nicht', { skip: skip || undefined }, async t => {
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return;
  }

  const U = 990501;
  const clean = async () => {
    await db.run('DELETE FROM parts WHERE user_id=$1', [U]);
    await db.run('DELETE FROM set_acquisitions WHERE user_id=$1', [U]);
    await db.run('DELETE FROM sets WHERE user_id=$1', [U]);
    await db.run('DELETE FROM parts_summary WHERE user_id=$1', [U]);
    await db.run('DELETE FROM parts_summary_state WHERE user_id=$1', [U]);
  };
  await clean();
  await db.run(
    "INSERT INTO users (id,username,password_hash,is_admin) VALUES ($1,'psum','x',false) ON CONFLICT DO NOTHING",
    [U],
  );
  // Zwei Sets, das zweite doppelt vorhanden — die Menge muss mitmultipliziert werden.
  await haeltSet(db, U, 'A-1', 1);
  await haeltSet(db, U, 'B-1', 2);
  // Farbbezeichnung und Name stehen seit Migration 0034 in den Katalogen.
  // Hier nicht nebensaechlich: Die Prüfungen unten suchen die Gruppe über
  // `color_name === 'Rot'`.
  await db.run(`INSERT INTO part_catalog (part_number, part_name) VALUES
    ('3001','Brick 2x4'),('3002','Plate 1x2'),('3003','Tile 1x1')
    ON CONFLICT (part_number) DO NOTHING`);
  await db.run(`INSERT INTO part_color_catalog (part_number, color_id, color_name) VALUES
    ('3001',5,'Rot'),('3002',1,'Blau'),('3003',2,'Gruen')
    ON CONFLICT (part_number, color_id) DO NOTHING`);
  await haeltTeil(db, U, '3001', { setNumber: 'A-1', menge: 3, colorId: 5 });
  await haeltTeil(db, U, '3001', { setNumber: 'B-1', menge: 4, colorId: 5 });
  await haeltTeil(db, U, '3002', { setNumber: 'A-1', menge: 1, colorId: 1 });
  // Die Setliste für 3003 steht schon jetzt im Katalog; unten kommt nur die
  // Bestandszeile dazu (eine Katalogänderung zöge die Gruppe sofort nach).
  await db.run(`INSERT INTO set_teile (set_number, part_number, color_id, quantity) VALUES ('A-1','3003',2,9)
                ON CONFLICT (set_number, part_number, color_id) DO UPDATE SET quantity = 9`);

  // Seit dem Fix baut ensureFresh() NICHT mehr im Request auf. Der erste
  // Zugriff eines Nutzers ohne Zusammenfassung wird deshalb aus der
  // Live-Abfrage bedient, während der Aufbau im Hintergrund anläuft. Für die
  // Inhaltsprüfung hier wird einmal explizit aufgebaut.
  const first = await H.getParts(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(first.source, 'db', 'ohne vorhandene Zusammenfassung muss die Live-Abfrage einspringen statt zu warten');
  await PS.rebuildNow(U);

  const r1 = await H.getParts(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(r1.source, 'summary', 'die Zusammenfassung wurde nicht benutzt');
  assert.equal(r1.total, 2, 'zwei Teil/Farb-Gruppen erwartet');
  const rot = r1.parts.find(p => p.color_name === 'Rot');
  assert.equal(rot.total_quantity, 3 * 1 + 4 * 2, 'die Set-Menge muss in die Teilemenge eingehen');

  // Änderung an parts → Trigger → nächster Lesezugriff baut neu auf
  await db.run(
    `INSERT INTO parts (user_id, set_number, part_number, color_id, source) VALUES ($1,'A-1','3003',2,'set')`,
    [U],
  );
  // Der Lesezugriff darf jetzt NICHT mehr blockieren: Er liefert den alten
  // Stand und stösst den Aufbau nur an. Erst danach stimmen die Zahlen wieder.
  const stale = await H.getParts(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(stale.total, 2, 'der Lesezugriff soll den alten Stand liefern, nicht warten');
  await PS.rebuildNow(U);
  const r2 = await H.getParts(U, { exclude_manual: '1', page: 1, page_size: 50 });
  assert.equal(r2.total, 3, 'nach dem Aufbau muss die neue Gruppe enthalten sein');

  // Änderung an der SETMENGE → ebenfalls. Sie steht seit Migration 0036 in
  // der Erfassung, nicht mehr in sets.quantity — und deshalb hängt der
  // Entwertungs-Trigger jetzt auch an set_acquisitions (src/teile/partsSummary.ts).
  // Ohne ihn bliebe die Zahl hier stehen und sähe dabei plausibel aus.
  await db.run("UPDATE set_acquisitions SET quantity=3 WHERE user_id=$1 AND set_number='B-1'", [U]);
  await PS.rebuildNow(U);
  const r3 = await H.getParts(U, { exclude_manual: '1', page: 1, page_size: 50 });
  const rot3 = r3.parts.find(p => p.color_name === 'Rot');
  assert.equal(rot3.total_quantity, 3 * 1 + 4 * 3, 'eine geänderte Set-Menge muss durchschlagen');

  // Der Schreibvorgang eines FREMDEN Kontos darf nichts entwerten
  const FREMD = 990502;
  await db.run(
    "INSERT INTO users (id,username,password_hash,is_admin) VALUES ($1,'psum2','x',false) ON CONFLICT DO NOTHING",
    [FREMD],
  );
  await PS.rebuildNow(U);
  assert.equal(await PS.ensureFresh(U, { strict: true }), true, 'Vorbedingung: die eigene Zusammenfassung ist frisch');
  await haeltTeil(db, FREMD, '9999', { menge: 1, colorId: 7 });
  assert.equal(
    await PS.ensureFresh(U, { strict: true }),
    true,
    'Ein fremdes Konto darf die eigene Zusammenfassung nicht entwerten',
  );
  // Die eigene Änderung dagegen schon. `updated_at=updated_at` schreibt
  // nichts Neues — der Trigger hängt am UPDATE, nicht am Wert. Hier stand
  // `quantity=quantity`; die Spalte ist mit Migration 0036 weg.
  await db.run("UPDATE sets SET updated_at=updated_at WHERE user_id=$1 AND set_number='A-1'", [U]);
  assert.equal(
    await PS.ensureFresh(U, { strict: true }),
    false,
    'Eine eigene Änderung an sets muss die Zusammenfassung entwerten',
  );

  // ── Und eine Änderung an den ERFASSUNGEN ebenso ─────────────────────────
  //
  // Neu mit Migration 0036: Die Setmenge steht dort. Ohne den Trigger auf
  // set_acquisitions wäre diese Zusicherung die einzige Stelle, an der der
  // Fehler auffiele — und sie ist genau deshalb hier.
  await PS.rebuildNow(U);
  assert.equal(
    await PS.ensureFresh(U, { strict: true }),
    true,
    'Vorbedingung: nach dem Neuaufbau ist die Zusammenfassung frisch',
  );
  // Ein geänderter Kaufpreis entwertet nicht (seit 0052), eine Menge schon.
  await db.run("UPDATE set_acquisitions SET purchase_price = 1 WHERE user_id=$1 AND set_number='A-1'", [U]);
  assert.equal(
    await PS.ensureFresh(U, { strict: true }),
    true,
    'Ein Kaufpreis ändert keine Teilemenge — die Zusammenfassung bleibt gültig',
  );
  await db.run("UPDATE set_acquisitions SET quantity=quantity+1 WHERE user_id=$1 AND set_number='A-1'", [U]);
  assert.equal(
    await PS.ensureFresh(U, { strict: true }),
    false,
    'Eine Änderung an den Erfassungen muss die Zusammenfassung entwerten — die ' +
      'Setmenge steht dort (Migration 0036), und total_quantity rechnet mit ihr',
  );
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
  // Katalog-Anreicherung), zahlte der nächste Aufruf des Teile-Reiters den …
  const src = fs.readFileSync(path.join(ROOT, 'src/teile/partsSummary.ts'), 'utf8');
  const fn = src.slice(
    src.indexOf('export async function ensureFresh'),
    src.indexOf('export async function rebuildNow'),
  );
  assert.ok(fn.length > 0, 'ensureFresh nicht gefunden');
  assert.doesNotMatch(
    fn,
    /await rebuild\(/,
    'ensureFresh darf nicht im Request aufbauen — genau das waren die drei Sekunden',
  );
  assert.match(fn, /rebuildInBackground\(/, 'Der Aufbau muss in den Hintergrund');
  assert.match(
    fn,
    /return state !== null/,
    'Veralteter Stand wird ausgeliefert; ohne jeden Stand übernimmt die Live-Abfrage',
  );

  assert.match(src, /const _rebuilding = new Map/, 'Ohne Sperre starten parallele Anfragen denselben Aufbau mehrfach');
  assert.match(
    src,
    /export async function rebuildNow/,
    'Für Stellen, die garantiert aktuelle Zahlen brauchen, muss es einen blockierenden Weg geben',
  );
});

test('Kennzahlen benutzen keinen veralteten Stand', () => {
  // Webapp und Android fragen dieselbe Statistik über zwei Endpunkte ab.
  // Während eines Hintergrund-Neuaufbaus las der eine aus der Zusammenfassung
  // und der andere live — die Paritätsprüfung schlug dadurch reproduzierbar
  // fehl. Mit strict weichen beide gemeinsam auf die Live-Abfrage aus.
  const ps = fs.readFileSync(path.join(ROOT, 'src/teile/partsSummary.ts'), 'utf8');
  assert.match(ps, /opts\?: \{ strict\?: boolean \}/, 'strict-Variante fehlt');
  assert.match(ps, /if \(opts\?\.strict\) return false;/, 'Ein veralteter Stand muss unter strict abgelehnt werden');

  const h = require('./helpers/sources').handlerQuelle();
  // Seit der Haushaltssicht bekommt der Helfer eine LISTE von Konten (uids)
  // und prüft jedes einzeln; strict gilt unverändert.
  assert.match(h, /await ensureFresh\(uids, \{ strict: true \}\)/, 'getPartsStats muss strict aufrufen');
  // Die Liste darf weiterhin den veralteten Stand nehmen — dort ist es egal
  assert.match(h, /tryPartsSummary\(userId/, 'Der Listenpfad bleibt unverändert');
});

test('beide Pfade der Kennzahlen zählen DASSELBE — auch mit manuellen Teilen', { skip: skip || undefined }, async t => {
  // Der Befund
  try {
    await db.initSchema();
  } catch (e) {
    keineDb(t, e);
    return;
  }

  const U = 990502;
  await db.run('DELETE FROM parts WHERE user_id=$1', [U]);
  await db.run('DELETE FROM set_acquisitions WHERE user_id=$1', [U]);
  await db.run('DELETE FROM sets WHERE user_id=$1', [U]);
  await db.run('DELETE FROM parts_summary WHERE user_id=$1', [U]);
  await db.run('DELETE FROM parts_summary_state WHERE user_id=$1', [U]);
  await db.run(
    "INSERT INTO users (id,username,password_hash,is_admin) VALUES ($1,'psum2','x',false) ON CONFLICT DO NOTHING",
    [U],
  );
  await haeltSet(db, U, 'A-1', 1);
  await haeltTeil(db, U, '3001', { setNumber: 'A-1', menge: 3, colorId: 5 });
  await haeltTeil(db, U, '9999', { menge: 11, colorId: 7 });

  // Weg 1: aus der Zusammenfassung.
  await PS.rebuildNow(U);
  const ausSummary = await H.getPartsStats([U]);

  // Weg 2: der Rückfall. Die Zusammenfassung wird dafür entfernt — dann
  // liefert ensureFresh(strict) false, und getPartsStats geht live.
  await db.run('DELETE FROM parts_summary WHERE user_id=$1', [U]);
  await db.run('DELETE FROM parts_summary_state WHERE user_id=$1', [U]);
  const ausLive = await H.getPartsStats([U]);

  assert.deepEqual(
    ausLive,
    ausSummary,
    'Die beiden Wege zählen Verschiedenes. Aus der Zusammenfassung: ' +
      `${JSON.stringify(ausSummary)}, live: ${JSON.stringify(ausLive)}. ` +
      'Das manuell erfasste Teil (Menge 11) gehört in keine der Set-Mengen.',
  );

  // Sorten und Farben zählen beide Quellen, wie die Liste darunter (siehe
  // teile-kennzahlen-einzeln-db.test.js); die Menge bleibt nach Quelle getrennt.
  assert.equal(ausSummary.unique_parts, 2, 'Das manuelle Teil fehlt in den Sorten');
  assert.equal(ausSummary.unique_colors, 2, 'Die Farbe des manuellen Teils fehlt');
  assert.equal(ausSummary.total_parts, 3, 'Die Menge des manuellen Teils steckt in der Summe');
  // Getrennt ausgewiesen: Der Teile-Reiter zählt beide zusammen, wie die
  // Kachel der Sammlung (/v1/stats). Gegenprobe (01.11.2026): manual_parts in
  // kennzahlen() fest auf 0 → rot „Die einzeln erfassten Teile fehlen …“.
  assert.equal(ausSummary.manual_parts, 11, 'Die einzeln erfassten Teile fehlen in der Aufschlüsselung');
  const gesamt = await S.getStats([U]);
  assert.deepEqual(
    [gesamt.total_parts, gesamt.set_parts, gesamt.manual_parts],
    [14, 3, 11],
    'Die Kachel der Sammlung zeigt nicht dieselbe Summe wie der Teile-Reiter',
  );

  await db.run('DELETE FROM parts WHERE user_id=$1', [U]);
  await db.run('DELETE FROM set_acquisitions WHERE user_id=$1', [U]);
  await db.run('DELETE FROM sets WHERE user_id=$1', [U]);
});

// Verbindungspool schliessen — sonst bleibt der Testprozess nach dem letzten
// Test hängen und der Läufer meldet die Datei als fehlgeschlagen, obwohl jede
// Prüfung grün war. Ohne erreichbare Datenbank fiel das nie auf: Dann wurde
// gar keine Verbindung geöffnet.
test('Verbindungen schliessen', async () => {
  await db.pool.end().catch(() => {});
});
