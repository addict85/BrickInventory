/**
 * initSchema() ist der ERSTSTART. Es laeuft nicht bei jedem Update, und das ist
 * richtig so.
 *
 * ── Was hier eigentlich gefunden wurde ──────────────────────────────────────
 *
 * In db/database.ts stand ein Riegel, der die Fassung des Deployments mit einem
 * Vermerk in `schema_meta` verglich, darueber der Satz „Nach einem Update
 * aendert sich die Version und die Migration laeuft genau einmal erneut".
 * Beides war unwahr, und das zweite waere gefaehrlich gewesen:
 *
 *  1. UNWAHR: Die Fassung kam aus `require('../package.json')`. Aus
 *     dist/db/database.js loest Node das nach dist/package.json auf — eine Datei,
 *     die es nicht gibt. Nachgemessen im gebauten Baum: MODULE_NOT_FOUND, also
 *     war die Fassung IMMER 'unknown', der Vergleich immer erfuellt, und
 *     initSchema() lief auf jeder bestehenden Datenbank nie wieder.
 *  2. GEFAEHRLICH, waere es wahr gewesen: initSchema() macht nicht nur Schema.
 *     Nachgezaehlt enthaelt es ein Dutzend datenverändernder Anweisungen —
 *     darunter `UPDATE users SET is_active=1, email_verified=1 WHERE is_admin=1`
 *     OHNE jeden Riegel. Bei jedem Deployment haette das ein abgeschaltetes
 *     Administratorkonto wieder freigeschaltet.
 *
 * Der Zustand, der aus Versehen entstand, ist also der richtige. Dieser Test
 * haelt ihn fest — denn ohne ihn ist er weiter nur ein Versehen, und das
 * naechste Versehen koennte ihn aufheben.
 *
 * ── Warum eine Sonde und keine Quelltextpruefung ────────────────────────────
 *
 * „Im Riegel steht `schonAngelegt`" waere eine Aussage ueber den Text. Geprueft
 * wird stattdessen die WIRKUNG: Ein Index, den ausschliesslich initSchema()
 * anlegt (idx_qr_login_expires — in keiner Migration erwaehnt, nachgezaehlt),
 * wird entfernt. Laeuft initSchema(), ist er wieder da. Laeuft es nicht, bleibt
 * er weg. Eindeutiger geht es nicht.
 *
 * Voraussetzung: Test-DB. Ohne DB: skip (mit REQUIRE_DB=1: Fehler).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const db = _req('db/database.js');

/** Der Index, den nur initSchema() anlegt. */
const SONDE = 'idx_qr_login_expires';

async function sondeDa() {
  const r = await db.get('SELECT 1 AS ok FROM pg_indexes WHERE indexname = $1', [SONDE]);
  return !!r;
}

test('initSchema laeuft beim Erststart, nicht bei jedem Update',
  { concurrency: 1 }, async (t) => {

  // Vorbau ueber initSchemaOnce() und NICHT ueber initSchema() + runMigrations:
  // `schema_meta` entsteht in initSchemaOnce(), nicht in initSchema(). Mit dem
  // naheliegenden Vorbau lief diese Datei allein gruen (eine frueher
  // zurueckgelassene Tabelle war noch da) und in der ganzen Reihe rot mit
  // `relation "schema_meta" does not exist` — andere Dateien raeumen das Schema
  // ab. Ein Vorbau, der nur allein funktioniert, ist kein Vorbau.
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  // Vorzustand sichern und am Ende wiederherstellen — andere Testdateien im
  // selben Lauf verlassen sich auf ein vollstaendiges Schema.
  const vorher = await db.get('SELECT applied_version FROM schema_meta WHERE id = 1');
  t.after(async () => {
    delete process.env.FORCE_SCHEMA_INIT;
    if (!await sondeDa()) await db.exec(
      `CREATE INDEX IF NOT EXISTS ${SONDE} ON qr_login_tokens(expires_at)`).catch(() => {});
    if (!vorher) await db.run('DELETE FROM schema_meta WHERE id = 1').catch(() => {});
    await db.pool.end().catch(() => {});
  });

  await t.test('mit Vermerk wird initSchema uebersprungen', async () => {
    await db.run(`INSERT INTO schema_meta (id, applied_version) VALUES (1, 'pruefstand')
                  ON CONFLICT (id) DO UPDATE SET applied_version = 'pruefstand'`);
    await db.exec(`DROP INDEX IF EXISTS ${SONDE}`);
    assert.equal(await sondeDa(), false, 'Die Sonde liess sich nicht entfernen — dann misst der Fall nichts.');

    delete process.env.FORCE_SCHEMA_INIT;
    await db.initSchemaOnce();

    assert.equal(await sondeDa(), false,
      `initSchema() hat ${SONDE} wieder angelegt, obwohl ein Schemastand vermerkt ist. ` +
      `Damit laeuft es auf einer bestehenden Datenbank — und dort traegt es geloeschte ` +
      `Erst-Erfassungen wieder ein und schaltet abgeschaltete Administratorkonten frei.`);
  });

  await t.test('FORCE_SCHEMA_INIT=1 ist der Notausgang und wirkt', async () => {
    // Eigenstaendig: Die Sonde wird hier selbst entfernt, nicht aus dem Fall
    // davor uebernommen. Sonst scheitert dieser Fall mit, wenn jener scheitert
    // — und zwei rote Meldungen fuer EINEN Fehler schicken die Suche in zwei
    // Richtungen.
    await db.run(`INSERT INTO schema_meta (id, applied_version) VALUES (1, 'pruefstand')
                  ON CONFLICT (id) DO UPDATE SET applied_version = 'pruefstand'`);
    await db.exec(`DROP INDEX IF EXISTS ${SONDE}`);
    assert.equal(await sondeDa(), false, 'Die Sonde liess sich nicht entfernen.');
    process.env.FORCE_SCHEMA_INIT = '1';
    try { await db.initSchemaOnce(); } finally { delete process.env.FORCE_SCHEMA_INIT; }
    assert.equal(await sondeDa(), true,
      `Mit FORCE_SCHEMA_INIT=1 muesste ${SONDE} wieder da sein. Ist er es nicht, ist der ` +
      `einzige Weg verschlossen, ein unvollstaendig angelegtes Schema von Hand nachzuziehen ` +
      `— und der Fall darueber beweist dann nur, dass initSchema() ueberhaupt nichts tut.`);
  });

  await t.test('der vermerkte Stand ist auffindbar, nicht "unknown"', async () => {
    const paket = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const r = await db.get('SELECT applied_version FROM schema_meta WHERE id = 1');
    assert.equal(r.applied_version, paket.version,
      `In schema_meta steht "${r?.applied_version}" statt "${paket.version}". Die Fassung ` +
      `kam aus require('../package.json') und war aus dist/db/ heraus nicht aufloesbar — ` +
      `damit war der Vermerk als Auskunft fuer die Fehlersuche wertlos. Jetzt kommt sie ` +
      `ueber APP_ROOT (utils/appPaths.ts), das genau diese Falle schon loest.`);
    assert.notEqual(r.applied_version, 'unknown');
  });

  await t.test('ein abgeschaltetes Administratorkonto bleibt abgeschaltet', async () => {
    const name = 'erststart-admin-pruefung';
    await db.run('DELETE FROM users WHERE username = $1', [name]);
    await db.run(`INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
                  VALUES ($1, 'x', 1, 0, 1)`, [name]);
    t.after(async () => { await db.run('DELETE FROM users WHERE username = $1', [name]).catch(() => {}); });

    await db.initSchema();
    const nach = await db.get('SELECT is_active FROM users WHERE username = $1', [name]);
    assert.equal(Number(nach.is_active), 0,
      'initSchema() hat ein bewusst abgeschaltetes Administratorkonto wieder freigeschaltet. ' +
      'Die Anweisung dafuer ist auf NULL-Werte eingeschraenkt — also auf Spalten, die es ' +
      'gerade erst gibt — und darf eine ABSICHTLICHE 0 nicht anfassen.');

    // ── Gegenprobe, im selben Lauf ────────────────────────────────────────
    // Ohne sie hiesse „die 0 steht noch" nur, dass initSchema() diese Zeile gar
    // nicht erreicht hat. Die alte, bedingungslose Fassung wird hier von Hand
    // ausgefuehrt: Sie MUSS die 0 umlegen, sonst prueft der Fall darueber nichts.
    await db.run('UPDATE users SET is_active=1, email_verified=1 WHERE is_admin=1 AND username = $1', [name]);
    const alt = await db.get('SELECT is_active FROM users WHERE username = $1', [name]);
    assert.equal(Number(alt.is_active), 1,
      'Die bedingungslose Fassung hat die 0 NICHT umgelegt — dann trifft die Zusicherung ' +
      'darueber eine Zeile, auf die es gar nicht ankommt.');
  });
});

/**
 * In db/database.ts sickert keine neue datenveraendernde Anweisung ein.
 *
 * ── Warum eine Ratsche und keine Regel ──────────────────────────────────────
 *
 * „initSchema() darf keine Daten aendern" waere falsch: Es legt den ersten
 * Administrator an, setzt die Vorgabewerte und traegt auf einer Datenbank, die
 * von einer aelteren Fassung kommt, Erst-Erfassungen nach. Das GEHOERT in den
 * Erststart.
 *
 * Gefaehrlich ist nicht, DASS es Daten anfasst, sondern dass niemand mehr
 * nachzaehlt, welche. Genau so entstand die Anweisung
 * `UPDATE users SET is_active=1, email_verified=1 WHERE is_admin=1` ohne jeden
 * Riegel — harmlos, solange initSchema() nur einmal laeuft, und ein
 * freigeschaltetes Administratorkonto in dem Moment, in dem jemand
 * FORCE_SCHEMA_INIT=1 setzt oder den Riegel „reparieren" will.
 *
 * Darum die Liste unten. Sie verbietet nichts — sie verlangt, dass eine neue
 * Zeile hier eingetragen und damit begruendet wird. Ein Eintrag, den niemand
 * mehr begruenden kann, faellt beim Lesen auf; eine Anweisung, die niemand
 * aufzaehlt, nicht.
 *
 * Gegenprobe (durchgefuehrt): Eine erfundene dreizehnte Anweisung
 * (`UPDATE sets SET …`) wird gemeldet, und ein Eintrag, der nichts mehr trifft,
 * ebenfalls — die Liste darf nicht verwahrlosen.
 */
test('db/database.ts aendert nur die aufgezaehlten Daten', () => {
  const quelle = fs.readFileSync(path.join(ROOT, 'db', 'database.ts'), 'utf8');
  // Kommentarzeilen ausblenden: Ein Absatz, der eine Anweisung ERKLAERT, nennt
  // sie zwangslaeufig — und wuerde sonst selbst als Treffer zaehlen.
  const ohneKommentare = quelle.split('\n')
    .map(z => { const t = z.trim(); return (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) ? '' : z; })
    .join('\n');

  /**
   * Was db/database.ts an Daten anfassen darf, mit dem Grund.
   * Schluessel: "<Operation> <Tabelle>".
   */
  const ERLAUBT = {
    'INSERT INTO users':                'legt den ersten Administrator an (Erststart)',
    'UPDATE users':                     'Vorgaben fuer Spalten, die es gerade erst gibt — beide auf NULL eingeschraenkt',
    'INSERT INTO global_settings':      'Vorgabewerte, mit ON CONFLICT DO NOTHING',
    'UPDATE global_settings':           'hebt NUR die exakten frueheren Standardwerte an',
    'DELETE FROM api_tokens':           'entfernt Token, die nicht wie SHA-256 aussehen (Altbestand)',
    'DELETE FROM price_history':        'entdoppelt Altbestand',
    'UPDATE minifigs':                  'schneidet Leerzeichen aus fig_number',
    'INSERT INTO part_acquisitions':    'traegt Erst-Erfassungen nach, mit NOT EXISTS-Riegel',
    'INSERT INTO minifig_acquisitions': 'traegt Erst-Erfassungen nach, mit NOT EXISTS-Riegel',
    'INSERT INTO set_acquisitions':     'traegt Erst-Erfassungen nach, mit NOT EXISTS-Riegel',
    'INSERT INTO schema_meta':          'vermerkt, dass das Schema angelegt wurde',
  };

  const gefunden = new Map();
  const muster = /\b(UPDATE|DELETE FROM|INSERT INTO)\s+([a-z_][a-z0-9_]*)/g;
  for (let m; (m = muster.exec(ohneKommentare)) !== null; ) {
    const schluessel = `${m[1]} ${m[2]}`;
    const zeile = ohneKommentare.slice(0, m.index).split('\n').length;
    if (!gefunden.has(schluessel)) gefunden.set(schluessel, []);
    gefunden.get(schluessel).push(zeile);
  }

  assert.ok(gefunden.size >= 10,
    `Nur ${gefunden.size} Sorten gefunden — zu wenig. Vermutlich greift das Muster nicht mehr, ` +
    `und dann besteht diese Pruefung stillschweigend.`);

  const neu = [...gefunden.keys()].filter(k => !(k in ERLAUBT))
    .map(k => `${k} (Zeile ${gefunden.get(k).join(', ')})`);
  assert.deepEqual(neu, [],
    'Neue datenveraendernde Anweisung(en) in db/database.ts:\n  ' + neu.join('\n  ') +
    '\n\nDiese Datei ist der ERSTSTART: Sie laeuft nur auf einer Datenbank, die noch keinen ' +
    'Schemastand vermerkt hat. Eine Aenderung, die bestehende Datenbanken erreichen soll, ' +
    'gehoert in eine Migration (db/migrations/). Ist die Anweisung wirklich Erststart-Arbeit, ' +
    'gehoert sie in die Liste ERLAUBT in dieser Datei — mit dem Grund, und mit einem Riegel, ' +
    'der eine ABSICHTLICHE Einstellung nicht ueberschreibt.');

  const verwaist = Object.keys(ERLAUBT).filter(k => !gefunden.has(k));
  assert.deepEqual(verwaist, [],
    'Diese Eintraege in ERLAUBT beschreiben nichts mehr: ' + verwaist.join(', ') +
    ' — die Anweisung steht nicht mehr in db/database.ts. Raus damit, sonst sieht die Liste ' +
    'nach einer Entscheidung aus und ist bloss noch Gewohnheit.');
});
