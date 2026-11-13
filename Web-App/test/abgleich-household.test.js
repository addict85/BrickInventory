/**
 * Haushalt — Konten verknüpfen.
 *
 * Die Regeln im Code und im Schema; was sich ausführen lässt, läuft gegen die
 * Datenbank hier oder in household-db.test.js.
 *
 * Gegenproben (08.11.2026 gemessen, jeweils zurückgenommen):
 *   A  einladungAnlegen speichert den Code statt seines Hashes → rot „der
 *      Einladungscode steht nur als Hash …“
 *   B  darfSchreibenFuer fragt haushaltVon() statt der Verknüpfung → rot
 *      „Schreibrechte kommen nie aus dem Gedächtnis“
 * Gestrichen, weil household-db.test.js dasselbe ausführt (dort je rot):
 *   „der Code wird atomar entwertet …“ (release() bei ungleicher Währung
 *   entfernt → „Verknüpfen braucht beide Seiten …“), „beide Seiten dürfen die
 *   Verknüpfung lösen“ (trenne() je Zweig ohne Wirkung → „ein Konto kann
 *   mehreren Hauptkonten angehören“, „Entkoppeln …“, „die Umstellung trennt
 *   Ketten …“), „der Kontofilter wird am Server in IDs übersetzt“ (blickfeldIds
 *   'own' → alle → „Blickfeld und Kontofilter“), „ein Set erscheint nur
 *   EINMAL“ (setsQuelle ohne Gruppierung → „dasselbe Set in zwei Konten …“),
 *   „Schreiben in ein fremdes Konto verlangt die richtige Richtung“
 *   (schreibzielOderNull ohne darfSchreibenFuer → „in ein fremdes Konto schreiben …“),
 *   „der Absender eines Eigentümerwechsels kommt aus der ZEILE“ (from = uid →
 *   „der Eigentümerwechsel greift die ZEILE …“).
 */
// Abgleich Web↔App: läuft in web-ci auch bei Änderungen unter Android-App/ (paths-Filter).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pruefeParameter } = require('./helpers/sources');
const kompakt = require('./helpers/sources').kompakt;

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('Einladung und Schreibrecht gegen die Datenbank', { concurrency: 1 }, async t => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
  const _req = require('./helpers/sources').buildAndRequire();
  const db = await require('./helpers/db').datenOderSkip(t, _req);
  if (!db) return;
  const hh = { ..._req('src/haushalt/haushalt.js'), ..._req('src/haushalt/prozess.js').haushaltBereich() };
  const namen = [`hh_haupt_${process.pid}`, `hh_unter_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1,'x') RETURNING id`, [n])).id);
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]).catch(() => {});
    hh.leereHaushaltCache();
    await db.pool.end().catch(() => {});
  });

  await t.test('ein Konto verknüpft sich nicht mit sich selbst', async () => {
    // Mehrere Elternkonten sind erlaubt (Migration 0046); die Verknüpfung mit sich selbst
    // verbietet das Schema. Gegenprobe (09.11.2026): Regel account_links_no_self entfernt → rot.
    await assert.rejects(
      db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $1)', [ids[0]]),
      (/** @type {any} */ e) => e.code === '23514',
    );
  });

  await t.test('der Einladungscode steht nur als Hash in der Datenbank', async () => {
    // Wie bei API-Tokens: Wer die Datenbank liest, soll keine Einladung einlösen können.
    const { code } = await hh.einladungAnlegen(ids[0]);
    assert.ok(code, 'kein Code erzeugt');
    const zeilen = await db.all('SELECT token_hash FROM account_link_invites WHERE main_user_id = $1', [ids[0]]);
    assert.equal(zeilen.length, 1);
    assert.notEqual(zeilen[0].token_hash, code, 'Der Code steht im Klartext in der Datenbank');
    const roh = code.replace(/[\s-]/g, '').toUpperCase();
    assert.ok(!zeilen[0].token_hash.toUpperCase().includes(roh), 'Der Code steht (umformatiert) in der Datenbank');
    assert.match(zeilen[0].token_hash, /^[0-9a-f]{64}$/, 'Gespeichert wird ein SHA-256-Hash');
  });

  await t.test('Schreibrechte kommen nie aus dem Gedächtnis', async () => {
    // Das Blickfeld ist gemerkt (haushalt-gedaechtnis-db.test.js); über einen
    // Schreibzugriff darf nur der Stand der Datenbank entscheiden.
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [ids[0], ids[1]]);
    hh.leereHaushaltCache();
    assert.deepEqual((await hh.haushaltVon(ids[0])).memberIds, ids, 'Vorbedingung: das Unterkonto ist gemerkt');
    assert.equal(await hh.darfSchreibenFuer(ids[0], ids[1]), true);
    // Von aussen gelöst, ohne dass dieser Prozess davon hört.
    await db.run('DELETE FROM account_links WHERE main_user_id = $1', [ids[0]]);
    assert.deepEqual((await hh.haushaltVon(ids[0])).memberIds, ids, 'Vorbedingung: das Gedächtnis ist noch alt');
    assert.equal(
      await hh.darfSchreibenFuer(ids[0], ids[1]),
      false,
      'darfSchreibenFuer entscheidet nach dem gemerkten Blickfeld',
    );
    assert.deepEqual(
      await hh.schreibbereich(ids[0]),
      [ids[0]],
      'schreibbereich entscheidet nach dem gemerkten Blickfeld',
    );
    assert.equal(await hh.darfSchreibenFuer(ids[1], ids[1]), true, 'Eigene Daten immer');
  });
});

test('Webapp und App bekommen dieselben Endpunkte', () => {
  // Etappe 6: Die vier Haushalts-Routen gibt es nur noch einmal, unter
  // /api/v1; die Webapp ruft dieselbe Adresse auf (requireToken nimmt beide
  // Ausweise). Vorher stand diese Prüfung über ZWEI Dateien und verlangte,
  // dass beide alles anbieten — die schwächere Fassung derselben Aussage.
  const src = read('routes/api_v1/settings.ts');
  for (const fn of ['haushaltsStand', 'einladungAnlegen', 'einladungEinloesen', 'kontenTrennen']) {
    assert.ok(src.includes(fn), `routes/api_v1/settings.ts: ${fn} fehlt`);
  }
  // Und die Zweitfassung darf nicht zurückkehren: jede Haushalts-Route genau einmal.
  for (const pfad of [
    "'/settings/household'",
    "'/settings/household/invite'",
    "'/settings/household/redeem'",
    "'/settings/household/unlink'",
  ])
    assert.equal(src.split(pfad).length - 1, 1, `${pfad} steht nicht genau einmal in routes/api_v1/settings.ts`);
  // Keine eigene Regel in der Route — sie stehen in src/haushalt/haushalt.ts.
  assert.doesNotMatch(src, /account_links/, 'Routen dürfen nicht selbst gegen account_links abfragen');
});

test('die Oberfläche bietet Einladen und Einlösen jedem Konto an', () => {
  // Ein Konto kann mehreren Hauptkonten angehören; jedes braucht seine eigene
  // Einladung. Ein ausgeblendetes Eingabefeld verhinderte genau das.
  const js = require('./helpers/sources').ansichtQuelle('einstellungen');
  assert.match(js, /inviteEl\.style\.display = ''/);
  assert.match(js, /redeemEl\.style\.display = ''/);
  const kt =
    read('../Android-App/feature-konto/src/main/java/ch/brickinventoryapp/konto/ui/screens/SettingsScreen.kt') +
    read(
      '../Android-App/feature-konto/src/main/java/ch/brickinventoryapp/konto/ui/screens/EinstellungenUnterseiten.kt',
    ) +
    read('../Android-App/feature-konto/src/main/java/ch/brickinventoryapp/konto/ui/screens/EinstellungenHaushalt.kt');
  assert.doesNotMatch(
    kt,
    /!st\.isSub\b/,
    'Die App blendet das Einlösen für Unterkonten aus — dann bleibt es bei einem Elternkonto',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Haushaltssicht: Listen, Finanzen, Verschieben, Schreibrechte
// ═══════════════════════════════════════════════════════════════════════════

test('die Portfoliokurve des Haushalts ist rückwirkend', () => {
  // Die Aussage bleibt, der Weg dahin hat sich geändert: Die
  // Portfolio-Schnappschüsse ('__portfolio__<id>') gibt es nicht mehr. Sie
  // lagen je Konto zu unterschiedlichen Zeitpunkten — addiert ergäben sie
  // Einbrüche, die nie stattgefunden haben — und sie hielten fest, was AN …
  const p = require('./helpers/sources').portfolioQuelle();
  assert.doesNotMatch(
    p,
    /__portfolio__/,
    'Der Schnappschuss-Weg ist zurück — er kann weder rückwirkend rechnen ' +
      'noch den heutigen Bestand über die Zeit zeigen',
  );
  assert.match(p, /GROUP BY s\.set_number/, 'Dasselbe Set in zwei Konten darf nicht doppelt in die Summe');
  assert.match(p, /FROM price_history ph/, 'Die Kurve muss aus dem Preisverlauf je Set entstehen');
});

test('Verschieben läuft über die Tagesregel, nicht über UPDATE user_id', () => {
  // Ein direktes UPDATE hinterliesse im Zielkonto zwei Erfassungen desselben
  // Tages — genau den Zustand, den der Bearbeiten-Pfad ablehnt.
  // ohneKommentare(): Die BEGRÜNDUNGEN dieser Regeln stehen in setMove.ts als
  // Kommentar, und sie ZITIEREN die Anweisungen, die es nicht mehr geben darf …
  const mv = kompakt(
    require('./helpers/sources').ohneKommentare(require('./helpers/sources').dienstQuelle('src/sets/setMove.ts')),
  );
  assert.ok(
    mv.includes("recordAcquisitionForDay('set', toId, [sn]"),
    'Erfassungen müssen einzeln über den gemeinsamen Helfer wandern',
  );
  assert.doesNotMatch(mv, /UPDATE set_acquisitions SET user_id/, 'Kein direktes Umhängen der Erfassungen');
  // Besitzt das Zielkonto das Set schon, addieren sich die Mengen dadurch,
  // dass die ERFASSUNGEN wandern — hier stand dafuer
  // `UPDATE sets SET quantity = quantity + $1`. Mit Migration 0036 gibt es die
  // Spalte nicht mehr, und ein Mengen-UPDATE auf `sets` waere jetzt ein
  // Fehler. Also genau umgekehrt geprueft.
  assert.doesNotMatch(
    mv,
    /UPDATE\s+sets\s+SET[^;`']*\bquantity\s*=/,
    'Die Stückzahl eines Sets wird nicht mehr geschrieben — sie steht in ' +
      'set_acquisitions und wird beim Lesen gerechnet (db/bestandsmenge.ts)',
  );

  // Der Wechsel des ganzen Sets liegt seit einer früheren Runde in der v1-Fabrik.
  const src = read('routes/api_v1/sets.ts');
  // Dies ist eine MUSTERregel: Sie faengt eine geloeschte Zeile. Dass die
  // Sperre wirklich greift — und zwar auf (Quellkonto, Set) und nicht auf dem
  // Zielkonto oder einem festen Schluessel — laeuft in
  // test/sperre-beim-verschieben-db.test.js ueber die echte Adresse; beides
  // zusammen, nicht eines statt des anderen.
  assert.ok(src.includes('sets.setVerschieben('), 'Die Route ruft den Dienst');
  assert.ok(
    kompakt(read('src/sets/dienst.ts')).includes('verschiebeSet(sk, sn, fromId'),
    'Das Verschieben läuft über verschiebeSet',
  );
  assert.ok(mv.includes('mitInventarSperre(sk.db, fromId, sn'), 'Serialisiert über das Quellkonto');
  // Ganzes Set und einzelne Kaufpreise laufen durch DIESELBE Umsetzung — der
  // Teilfall ist kein Sonderweg, sondern der allgemeine Fall mit Auswahl.
  const acq = read('routes/api_v1/acquisitions.ts');
  const calls =
    (mv.match(/moveSetBetweenAccounts\((?:sk, )?tx, sn/g) || []).length +
    (acq.match(/moveSetBetweenAccounts\(tx, sn/g) || []).length;
  assert.ok(
    calls >= 1,
    'Der Eigentümerwechsel muss über moveSetBetweenAccounts laufen — in routes/sets.ts ' +
      '(ganzes Set) oder in der gemeinsamen Fabrik (einzelne Kaufpreise)',
  );
});

test('manuelle Teile und Minifiguren tragen den Besitzer', () => {
  // Anders als Sets werden sie NICHT verdichtet: Zwei Konten mit demselben
  // Teil sind zwei Bestände mit eigener Menge und eigenem Kaufpreis, und jeder
  // Bearbeiten-Weg führt auf genau eine Zeile. Ohne Plakette sähe die Liste
  // wie eine doppelte Zeile aus.
  const h = kompakt(require('./helpers/sources').handlerQuelle());
  // Auf die Parameter geprüft, nicht auf den Wortlaut: `rows: any[]` eines Tages
  // zu `rows: Row[]` zu schärfen ist eine Verbesserung und darf hier nicht als
  // Fehler erscheinen (siehe pruefeParameter() im Helfer).
  pruefeParameter(h, 'besitzerAnhaengen', ['uids', 'rows']);
  assert.match(
    h,
    /if \(uids\.length < 2 \|\| !rows\?\.length\) return rows;/,
    'Im Einzelkonto darf keine Plakette erscheinen',
  );
  // Der Tabellenname davor ist seit Migration 0031 erlaubt: Die Abfrage
  // verbindet den Vorrat, um den Lagerortnamen aufzuloesen, und muss ihre
  // Spalten deshalb qualifizieren (`t.id` statt `id`). Die Aussage bleibt
  // dieselbe — ohne user_id in der Auswahl gibt es keinen Besitzer.
  assert.match(
    h,
    /SELECT (?:t\.)?id, (?:t\.)?user_id, (?:t\.)?part_number/,
    'Ohne user_id in der Abfrage gibt es keinen Besitzer',
  );

  const fc = kompakt(require('./helpers/sources').finanzQuelle());
  const uses = (fc.match(/await (?:kx?\.haushalt\.)?besitzerAnhaengen\(uids,/g) || []).length;
  // Seit der UI-Prüfung 12 auch die Sets: Jede Zeile ist der Bestand eines Kontos.
  assert.equal(uses, 3, 'Set-, Teile- und Minifiguren-Bewertung brauchen den Besitzer');
});

test('die Teile-Zusammenfassung trägt auch über mehrere Konten', () => {
  // Die Tabelle ist JE KONTO aufgebaut. Für den Haushalt wird über alle
  // beteiligten Konten gelesen und über part_key verdichtet — dasselbe Teil in
  // zwei Konten ergibt EINE Zeile mit der Summe, genau wie dasselbe Teil aus
  // zwei Sets innerhalb eines Kontos.
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(
    h,
    /const groupSql = multi \? ' GROUP BY part_key, color_id' : '';/,
    'Ohne Gruppierung erschiene dasselbe Teil je Konto einmal',
  );
  assert.match(
    h,
    /SELECT 1 FROM parts_summary WHERE \$\{where\} GROUP BY part_key, color_id/,
    'Auch die Gesamtzahl muss Teile zählen, nicht Konten',
  );
  assert.match(
    h,
    /COUNT\(DISTINCT ps\.part_key\)::int AS unique_parts/,
    'COUNT(*) zählte im Haushalt Konten statt Teile — und ::int muss bleiben, ' +
      'sonst hängt der JSON-Typ am Zweig (früher: SUM(BIGINT) käme als Zahl, ' +
      'SUM(INTEGER) als Text)',
  );

  // Frisch ist die Sicht nur, wenn sie es für JEDES Konto ist — „zwei von drei
  // sind aktuell" ergäbe eine Summe aus frischen und alten Beständen.
  const ps = read('src/teile/partsSummary.ts');
  assert.match(ps, /const results = await Promise\.all\(ids\.map\(id => ensureFresh\((?:k, )?id, opts\)\)\);/);
  assert.match(ps, /return results\.every\(Boolean\);/);
});

test('die Oberfläche zeigt Besitzer und Kontoauswahl nur im Haushalt', () => {
  // Im Einzelkonto stünde an jeder Kachel „gehört mir" — reines Rauschen.
  const gal = kompakt(require('./helpers/sources').frontendQuelle());
  assert.match(gal, /export function ownerBadges/);
  assert.match(gal, /if \(!item\?\.owners\?\.length\) return '';/);
  // Eine Auswahl mit einer einzigen Möglichkeit ist keine Auswahl.
  assert.match(gal, /if \(members\.length < 2\) \{ box\.style\.display = 'none'; continue; \}/);
  // Alle drei Erfassen-Formulare bekommen dieselbe Liste — Set, manuelles
  // Teil, manuelle Minifigur. Vorher war die Kontoauswahl nur bei Sets da.
  // Seit sind es VIER Formulare — der Katalog-Dialog („In Galerie
  // aufnehmen") war als einziger nicht angeschlossen und erfasste immer aufs …
  for (const feld of ['add-owner', 'ap-owner', 'af-owner', 'cat-m-owner']) {
    assert.ok(
      gal.includes(`'${feld}'`),
      `Die Kontoauswahl fehlt im Erfassungsweg ${feld} — dort landet dann alles ` +
        'stillschweigend beim eigenen Konto',
    );
  }
  assert.match(gal, /\['add-owner', 'ap-owner', 'af-owner'/, 'Die Kontoauswahl gehört in alle drei Erfassen-Formulare');
  const fig = kompakt(require('./helpers/sources').frontendQuelle());
  assert.match(fig, /owner_user_id: selectedOwner\('ap-owner'\)/);
  assert.match(fig, /owner_user_id: selectedOwner\('af-owner'\)/);
  // Und die Besitzer-Plakette auf den manuellen Kacheln.
  assert.match(fig, /\$\{ownerBadges\(p\)\}/);
  assert.match(fig, /\$\{ownerBadges\(f\)\}/);
  // Der Verschieben-Kasten im Set-Dialog ist entfernt: Verschoben wird über
  // den KAUFPREIS, Zeile für Zeile. Geprüft wird jetzt, dass die
  // Eigentümer-Spalte im Kaufpreis-Dialog nur im Haushalt erscheint — und
  // zwar in BEIDEN Dialogen (Sets und manuelle Einträge).
  const adm = kompakt(require('./helpers/sources').adminQuelle());
  assert.doesNotMatch(
    adm,
    /renderMoveBox|moveSetToAccount/,
    'Das ganze Set darf nicht mehr auf einmal verschoben werden',
  );
  const ownerCols = (
    adm.match(
      /erfassung\.mitglieder\.length > 1 \? (?:html)?`<th>\$\{t(?:Raw)?\('household\.owner'\)\}<\/th>` : ''/g,
    ) || []
  ).length;
  assert.equal(ownerCols, 2, 'Eigentümer-Spalte fehlt in einem der beiden Kaufpreis-Dialoge');
});

test('der Kontofilter gilt je Ansicht und wird überall mitgeschickt', () => {
  // Wer in der Galerie den ganzen Haushalt sieht, will in den Finanzen
  // womöglich nur die eigenen Zahlen — deshalb je Ansicht ein eigener Wert.
  const core = require('./helpers/sources').coreQuelle();
  // 'merkliste' ist am 24.09. dazugekommen (Marcos Vorgabe: „In der Merkliste
  // noch einen Filter analog den Sets einbauen inkl. Inhaber"). Der Server
  // verstand `accounts=` auf /v1/wanted schon immer — es fehlte allein die
  // Wahl in den Oberflaechen.
  assert.match(core, /export const SCOPE_VIEWS = \['gallery', 'parts', 'minifigs', 'finance', 'merkliste'\];/);
  assert.match(core, /localStorage\.getItem\('bim_scope_' \+ view\)/, 'Die Wahl soll einen Neuladen überleben');
  // 'all' ist die Vorgabe des Servers und wird weggelassen.
  assert.match(core, /if \(m && m !== 'all'\) p\.set\('accounts', m\);/);

  // Jede der fünf Ansichten hängt ihn an ihre Abfragen.
  assert.match(read('public/js/gallery.js'), /addScopeParam\(p, 'gallery'\)/);
  assert.match(read('public/js/parts.js'), /addScopeParam\(p, 'parts'\)/);
  assert.match(read('public/js/minifigs.js'), /addScopeParam\(p, 'minifigs'\)/);
  assert.match(read('public/js/merkliste.js'), /addScopeParam\(p, 'merkliste'\)/);

  // Im Finanzreiter ALLE vier Abfragen — sonst stünde eine Summe aus einem
  // Blickfeld neben einer Aufstellung aus einem anderen.
  const fin = read('public/js/finance.js') + read('public/js/wertkurve.js');
  // Adressen seit Etappe 5 unter /v1 — die Regel ist unverändert: ALLE vier
  // Abfragen des Reiters tragen denselben Filter.
  for (const ep of [
    '/v1/finance/valuation',
    '/v1/finance/parts-valuation',
    '/v1/finance/minifigs-valuation',
    '/v1/finance/pnl',
  ]) {
    assert.ok(
      fin.includes(`'${ep}'+scopeQuery('finance')`) || fin.includes(`\`${ep}\${scopeQuery('finance')}\``),
      `${ep} ohne Kontofilter`,
    );
  }
  assert.match(
    fin,
    /portfolio-history\?period=\$\{_chartPeriod\}\$\{scopeMode\('finance'\)/,
    'Auch die Kurve muss dem Filter folgen',
  );
});

test('der Umschalter lädt nur die betroffene Ansicht neu', () => {
  // Alle vier gleichzeitig neu zu laden würde drei Ansichten anfassen, die
  // niemand ansieht — und dabei Preisabrufe auslösen.
  const gal = kompakt(require('./helpers/sources').frontendQuelle());
  assert.match(gal, /export function onScopeChange\(view\)/);
  assert.match(gal, /if \(view === 'finance'\) loadFinance\(\);/);
  // Die Reiter Teile und Minifiguren haben ZWEI Listen — die aus Sets und die
  // manuell erfassten. Der manuelle Bereich lädt über einen eigenen Endpunkt
  // und blieb sonst ungefiltert stehen.
  assert.match(gal, /if \(view === 'parts'\) \{ loadParts\(\); loadManualParts\(\); \}/);
  // Und er erscheint nur bei einem Hauptkonto mit Unterkonten.
  assert.match(gal, /if \(!isMain\) \{ el\.style\.display = 'none'; continue; \}/);
  assert.match(gal, /initScopeSelects\(members\);/);
  // Ein Eintrag je Unterkonto, namentlich.
  assert.match(
    gal,
    /subs\.map\(m => (?:html)?`<option value="\$\{m\.id\}">/,
    'Die Auswahl muss jedes Unterkonto einzeln führen',
  );
});

test('Verschieben geht NUR über den Kaufpreis', async () => {
  // Ein Set als Ganzes zu verschieben klingt bequem, verdeckt aber, was
  // tatsächlich wandert: Drei Erfassungen sind drei Käufe, die im Haushalt
  // verschiedenen Kindern gehören können. Wer alles verschieben will, ändert
  // jede Zeile — und sieht dabei, wie viele es sind. …
  const { setVerschieben } = require('./helpers/sources').buildAndRequire()('src/sets/index.js');
  await assert.rejects(
    setVerschieben(1, '10294-1', 1, 2, []),
    (/** @type {any} */ e) => e.art === 'ungueltig' && e.code === 'kaufpreise_angeben',
    'move ohne acquisition_ids muss abgelehnt werden',
  );

  // Und die Oberfläche bietet es gar nicht erst an.
  assert.doesNotMatch(require('./helpers/sources').adminQuelle(), /renderMoveBox|moveSetToAccount/);
  assert.doesNotMatch(read('public/index.html'), /m-move-box/);
});

/**
 * Was diese Regel prüft, und was NICHT
 */
test('auch manuelle Teile und Minifiguren wandern über den Kaufpreis', () => {
  // Dieselbe Regel für alle drei Arten. Ein manuell erfasstes Teil hat keinen
  // Inhalt — es wandern nur Menge und Erfassung.
  const mv = kompakt(read('src/sets/setMove.ts'));
  assert.match(mv, /export async function moveManualAcquisition/);
  assert.match(mv, /recordAcquisitionForDay\(kind, toId, keyValues/, 'Auch hier gilt: eine Tageszeile je Konto');

  // Die Erfassungs-Routen stehen nur noch in der v1-Fabrik, die
  // jetzt Webapp UND App bedient. Die Regel gilt unverändert — sie wird nur an
  // EINER Stelle geprüft statt an dreien, weil es nur noch eine gibt.
  // Teile und Figuren gehen über denselben Aufruf; die Art kommt aus der Tabelle.
  // Die Regel steht seit dem Schichtumbau im Dienst; die Route ruft ihn nur.
  const f = 'src/sammlung/erfassungen.ts';
  const src = kompakt(read(f));
  assert.ok(src.includes('moveManualAcquisition(tx, art, keys, id, from, to)'), `${f}: Wechsel fehlt`);
  assert.match(
    src,
    /if \(to === null\) fachfehler\('verboten', 'kein_schreibrecht'\)/,
    `${f}: ohne Schreibrecht muss 403 kommen`,
  );
});

test('die App-Routen kennen den Eigentümerwechsel', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Die Android-App schickte owner_user_id an die v1-PUT-Routen — die Fabrik
  // las aber nur Menge, Preis und Zustand. Die Anfrage lief als LEERES Update
  // durch und antwortete success:true: Der Wechsel in der App war ein
  // stiller No-op, ohne Fehlermeldung und ohne Bewegung.
  const v1 = read('src/sammlung/erfassungen.ts');
  assert.match(v1, /body\.owner_user_id/, 'Der Erfassungsdienst muss owner_user_id auswerten');
  assert.match(
    v1,
    /moveSetBetweenAccounts\(tx, String\(keys\[0\]\), from, to, \[id\]\)/,
    'Sets wandern über dieselbe Umsetzung wie beim Verschieben',
  );
  assert.match(v1, /moveManualAcquisition\(tx, art, keys, id, from, to\)/);
});
