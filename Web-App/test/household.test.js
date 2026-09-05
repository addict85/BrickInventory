/**
 * Haushalt — Konten verknüpfen.
 *
 * Geprüft wird hier, was ohne laufende Datenbank prüfbar ist: die Regeln im
 * Code und im Schema. Die Regeln selbst sind der heikle Teil — jede einzelne
 * verhindert einen Zustand, aus dem es kein sauberes Zurück gäbe.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pruefeParameter } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('ein Konto gehört zu höchstens einem Haushalt', () => {
  // Ohne diese Grenze stünde ein Set in zwei Haushaltssichten gleichzeitig,
  // und beim Verschieben wäre nicht mehr eindeutig, wer es darf.
  const mig = read('db/migrations/0005-haushalt-kontoverknuepfung.sql');
  assert.match(mig, /CONSTRAINT account_links_sub_unique UNIQUE \(sub_user_id\)/);
  assert.match(mig, /CHECK \(main_user_id <> sub_user_id\)/,
    'Ein Konto darf sich nicht mit sich selbst verknüpfen');
});

test('nur eine Stufe — in beide Richtungen geprüft', () => {
  // Zwei Fälle, und beide müssen abgefangen sein: Ein Konto mit eigenen
  // Unterkonten darf nicht Unterkonto werden, und ein Unterkonto darf keine
  // aufnehmen. Fehlte einer, entstünde eine Kette, für die jede Abfrage eine
  // rekursive Auflösung samt Zyklusschutz bräuchte.
  //
  // Geprüft wird, DASS die drei Fälle abgefragt werden — nicht, wie die
  // Variablen heissen. Hier standen `subState.isMain`, `mainState.linkedToMainId`
  // und `own.linkedToMainId` als exakte Muster: Eine reine Umbenennung machte
  // den Test rot, obwohl das Verhalten unverändert war. Ein Test, der bei
  // folgenlosen Umbenennungen anschlägt, wird beim nächsten Refactoring
  // angepasst statt gelesen — und verliert damit genau die Warnwirkung, für
  // die er da ist.
  //
  // Ob die Regel WIRKT, beantwortet household-db.test.js („nur eine Stufe")
  // gegen echte Daten. Diese Datei hält fest, dass alle drei Richtungen
  // überhaupt bedacht sind.
  const h = read('utils/household.ts');
  assert.match(h, /\.isMain\b/, 'Wer Unterkonten hat, darf nicht Unterkonto werden');
  assert.equal((h.match(/\.linkedToMainId\b/g) || []).length >= 2, true,
    'Ein Unterkonto darf weder einladen noch einen Code erzeugen — zwei getrennte Prüfungen');
});

test('die Währung muss übereinstimmen', () => {
  // Die Haushaltssicht summiert Beträge. CHF und EUR ergäben eine Summe aus
  // zwei Währungen — kommentarlos falsch, und niemand sähe es der Zahl an.
  //
  // Auch hier ohne die Namen der Zwischenvariablen: `String(curMain) !==
  // String(curSub)` als exaktes Muster brach bei jeder Umbenennung. Wichtiger
  // ist, dass beide Währungen überhaupt geholt und verglichen werden.
  //
  // Und der Vergleich muss WIRKEN — das prüft household-db.test.js
  // („Verknüpfen braucht beide Seiten und dieselbe Währung") gegen echte
  // Daten. Nachgestellt: Hängt man an die Bedingung ein `&& false`, bleiben
  // die Prüfungen hier grün und nur der Datenbanktest wird rot. Genau dafür
  // gibt es ihn.
  const h = read('utils/household.ts');
  assert.match(h, /getSetting\(mainId, 'currency'/);
  assert.match(h, /getSetting\(subId, 'currency'/);
  assert.match(h, /String\([A-Za-zäöü]+\) !== String\([A-Za-zäöü]+\)/,
    'Die beiden Währungen müssen verglichen werden');
});

test('der Einladungscode steht nur als Hash in der Datenbank', () => {
  // Wie bei API-Tokens und QR-Anmeldecodes: Wer die Datenbank liest, soll
  // keine Einladung einlösen können.
  const h = read('utils/household.ts');
  assert.match(h, /createHash\('sha256'\)/);
  assert.match(h, /VALUES \(\$1,\$2,\$3\)[\s\S]{0,120}hash\(code\)/,
    'Gespeichert wird der Hash, nicht der Code');

  const mig = read('db/migrations/0005-haushalt-kontoverknuepfung.sql');
  assert.match(mig, /token_hash\s+TEXT\s+PRIMARY KEY/);
  assert.match(mig, /expires_at\s+TIMESTAMPTZ\s+NOT NULL/, 'Codes müssen ablaufen');
  assert.match(mig, /used_at\s+TIMESTAMPTZ/, 'Codes sind einmalig einlösbar');
});

test('der Code wird atomar entwertet und bei Ablehnung wieder freigegeben', () => {
  const h = read('utils/household.ts');
  // Atomar: Nur die erste Anfrage bekommt eine Zeile zurück.
  assert.match(h, /UPDATE account_link_invites SET used_at = NOW\(\)[\s\S]{0,200}WHERE token_hash = \$1 AND used_at IS NULL AND expires_at > NOW\(\)[\s\S]{0,60}RETURNING main_user_id/);
  // Und wieder frei, wenn eine Regel greift — sonst wäre der Code nach einem
  // Währungsfehler verbraucht, obwohl niemand verknüpft wurde.
  assert.match(h, /SET used_at = NULL, used_by = NULL/);
  const releases = (h.match(/await release\(\);/g) || []).length;
  assert.ok(releases >= 5, `nur ${releases} Freigaben — jede Ablehnung nach dem Entwerten braucht eine`);
});

test('Lesen weit, Schreiben eng', () => {
  const h = read('utils/household.ts');
  // Das Blickfeld erweitert das LESEN. Ob jemand schreiben darf, beantwortet
  // eine eigene Funktion — nicht die Mitgliedschaft im Blickfeld.
  assert.match(h, /export async function canWriteFor/);
  assert.match(h, /if \(actor === owner\) return true;/);
  assert.match(h, /FROM account_links WHERE main_user_id = \$1 AND sub_user_id = \$2/,
    'Schreiben auf fremde Daten nur als Hauptkonto des Besitzers');
});

test('ein Unterkonto sieht nur sich selbst', () => {
  // Der Hauptaccount ist eine Sicht, kein gemeinsamer Topf: Die Sammlung der
  // Geschwister geht ein Kind nichts an.
  const h = read('utils/household.ts');
  assert.match(h, /memberIds: \[id, \.\.\.subIds\]/);
  assert.doesNotMatch(h, /memberIds:[^\n]*mainId/,
    'Das Hauptkonto darf nicht im Blickfeld eines Unterkontos stehen');
});

test('beide Seiten dürfen die Verknüpfung lösen', () => {
  // Ein Unterkonto, das nicht mehr mitmachen will, wäre sonst auf das
  // Wohlwollen des Hauptkontos angewiesen.
  const h = read('utils/household.ts');
  assert.match(h, /DELETE FROM account_links WHERE main_user_id = \$1 AND sub_user_id = \$2/);
  assert.match(h, /DELETE FROM account_links WHERE sub_user_id = \$1/);
});

test('Webapp und App bekommen dieselben Endpunkte', () => {
  // Etappe 6: Die vier Haushalts-Routen gibt es nur noch einmal, unter
  // /api/v1; die Webapp ruft dieselbe Adresse auf (requireToken nimmt beide
  // Ausweise). Vorher stand diese Prüfung über ZWEI Dateien und verlangte,
  // dass beide alles anbieten — die schwächere Fassung derselben Aussage.
  const src = read('routes/api_v1/settings.ts');
  for (const fn of ['householdStatus', 'createInvite', 'redeemInvite', 'unlink']) {
    assert.ok(src.includes(fn), `routes/api_v1/settings.ts: ${fn} fehlt`);
  }
  // Und die Zweitfassung darf nicht zurückkehren.
  assert.doesNotMatch(read('routes/settings.ts'), /householdStatus|createInvite|redeemInvite/,
    'routes/settings.ts hat wieder eigene Haushalts-Routen — dann existiert die Logik doppelt');
  // Keine eigene Regel in der Route — sie stehen in utils/household.ts.
  for (const f of ['routes/settings.ts', 'routes/api_v1/settings.ts']) {
    assert.doesNotMatch(read(f), /account_links/,
      `${f}: Routen dürfen nicht selbst gegen account_links abfragen`);
  }
});

test('die Oberfläche zeigt nur den passenden Kasten', () => {
  // Ein Knopf, der immer eine Fehlermeldung erzeugt, ist schlimmer als keiner.
  const js = read('public/js/05-settings.js');
  assert.match(js, /inviteEl\.style\.display = d\.is_sub \? 'none' : ''/,
    'Ein Unterkonto darf keinen Einladungsknopf sehen');
  assert.match(js, /redeemEl\.style\.display = \(d\.is_sub \|\| d\.is_main\) \? 'none' : ''/,
    'Wer Unterkonten hat, braucht kein Eingabefeld');
});

// ═══════════════════════════════════════════════════════════════════════════
// Haushaltssicht: Listen, Finanzen, Verschieben, Schreibrechte
// ═══════════════════════════════════════════════════════════════════════════

test('der Kontofilter wird am Server in IDs übersetzt, nicht in der Oberfläche', () => {
  // Ein Hauptkonto schaltet je Ansicht zwischen Alle / Eigene / Unterkonten.
  // Der Wert reist als Anfrageparameter mit und wird an EINER Stelle in
  // Konto-IDs übersetzt — dadurch kennt ihn jede Zahl derselben Antwort
  // automatisch. Eine Kachelwand liesse sich clientseitig aussieben, die
  // Gesamtzahl darunter und die Bewertung im Finanzreiter nicht.
  const h = read('utils/household.ts');
  assert.match(h, /export async function scopeIds\(uid: number, mode: ScopeMode = 'all'\)/);
  assert.match(h, /if \(mode === 'own'\)  return \[id\];/);
  assert.match(h, /if \(mode === 'subs'\) return h\.memberIds\.filter\(m => m !== id\);/);
  // Einzelne Konten: Die Auswahl führt jedes Unterkonto namentlich, und dann
  // reist dessen ID mit. Eine FREMDE ID darf nicht durchschlagen — der Filter
  // ist eine Ansichtshilfe, kein Zugriffsweg.
  assert.match(h, /return h\.memberIds\.includes\(mode\) \? \[mode\] : h\.memberIds;/,
    'Eine kontofremde ID muss auf das ganze Blickfeld zurückfallen');
  // Ein Konto ohne Unterkonten sieht sich selbst — 'subs' wäre dort eine leere
  // Ansicht ohne erkennbaren Grund.
  assert.match(h, /if \(!h\.isMain\) return h\.memberIds;/);
  // Unbekannte Werte fallen auf 'all' zurück, statt die Ansicht zu leeren;
  // eine Zahl reist durch und wird erst in scopeIds() gegen den Haushalt
  // geprüft.
  assert.match(h, /if \(v === 'own' \|\| v === 'subs'\) return v;/);
  assert.match(h, /return Number\.isFinite\(n\) && n > 0 \? n : 'all';/);

  // Und jeder Lesepfad reicht den Filter durch — einer, der es vergisst, zeigt
  // stumm den ganzen Haushalt, während die Ansicht daneben gefiltert ist.
  // routes/minifigs.ts steht seit Nachtrag 72 NICHT mehr in dieser Liste: Seine
  // Leserouten sind mit der v1-Fabrik zusammengelegt, übrig sind /stats sowie
  // CSV-Import/-Export. Die Regel selbst gilt unverändert — sie wird für
  // Minifiguren jetzt an routes/api_v1/minifigs.ts geprüft, das weiter unten in
  // derselben Liste steht.
  // routes/parts.ts fällt mit Nachtrag 73 ebenfalls weg (wie minifigs.ts in 72):
  // seine Leserouten liegen in der v1-Fabrik, übrig sind /categories und die
  // CSV-Wege. Die Regel wird für Teile an routes/api_v1/parts.ts geprüft, das
  // weiter unten in derselben Liste steht.
  // Mit Nachtrag 74 ist auch routes/sets.ts raus: seine Leserouten liegen in der
  // v1-Fabrik, übrig sind CSV/SSE, Anleitungen und info/export. Die Regel wird
  // für Sets an routes/api_v1/sets.ts geprüft — weiter unten in derselben Liste.
  // routes/finance.ts fällt mit Etappe 5 weg (wie minifigs.ts in 72, parts.ts in
  // 73, sets.ts in 74): Bewertung, GuV, Portfolio- und Preisverlauf liegen in
  // der v1-Familie, übrig sind Cache-Statistik und die Preis-Job-Werkzeuge —
  // alles ohne Kontobezug. Die Regel wird für die Finanzen an
  // routes/api_v1/finance.ts geprüft, das weiter unten in derselben Liste steht.
  // routes/settings.ts fällt mit Etappe 6 weg: /stats und die Haushalts-Routen
  // liegen in der v1-Familie, übrig sind Formular, Export/Import, Token und die
  // Admin-Felder — alles ohne Kontofilter. Geprüft wird die Regel für die
  // Einstellungen an routes/api_v1/settings.ts und routes/api_v1/misc.ts.
  for (const f of ['routes/api_v1/sets.ts', 'routes/api_v1/parts.ts',
                   'routes/api_v1/minifigs.ts', 'routes/api_v1/finance.ts',
                   'routes/api_v1/misc.ts']) {
    const src = read(f);
    const lines = src.split('\n').filter(l => l.includes('await scopeIds('));
    assert.ok(lines.length > 0, `${f}: kein scopeIds-Aufruf`);
    for (const l of lines) {
      assert.ok(l.includes('parseScopeMode(req.query.accounts)'),
        `${f}: scopeIds ohne Kontofilter — ${l.trim()}`);
    }
  }
});

test('ein Set erscheint nur EINMAL, mit der Summe der Mengen', () => {
  // Zwei Kinder mit demselben Set ergäben sonst zwei Zeilen mit gleichem Bild
  // und Namen — das liest sich wie ein Fehler in der Liste.
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(h, /SUM\(s\.quantity\)::int AS quantity/,
    'Mengen müssen addiert werden');
  // FILTER seit Nachtrag 83: Ein Konto, dessen Kaufpreis gelöscht wurde, steht
  // mit Menge 0 in der Tabelle und soll nicht mehr als Besitzer erscheinen.
  assert.match(h, /array_agg\(DISTINCT s\.user_id\) FILTER \(WHERE s\.quantity > 0\) AS owner_ids/,
    'Ohne Besitzer verschiebt man das falsche Exemplar — und ohne FILTER steht ' +
    'ein Konto ohne Exemplar weiter auf der Kachel');
  assert.match(h, /GROUP BY s\.set_number\) s/,
    'Die Unterabfrage muss dieselben Spaltennamen liefern wie die Tabelle');
  // Ohne Haushalt wird gar nicht erst gruppiert — dann ist es die alte Abfrage.
  assert.match(h, /uids\.length > 1\s*\n?\s*\?/, 'Einzelkonto darf nicht gruppieren');
});

test('die Portfoliokurve des Haushalts ist rückwirkend', () => {
  // Die Aussage bleibt, der Weg dahin hat sich geändert (Nachtrag 82): Die
  // Portfolio-Schnappschüsse ('__portfolio__<id>') gibt es nicht mehr. Sie
  // lagen je Konto zu unterschiedlichen Zeitpunkten — addiert ergäben sie
  // Einbrüche, die nie stattgefunden haben — und sie hielten fest, was AN
  // JENEM TAG erfasst war, konnten also nicht rückwirkend rechnen.
  //
  // Jetzt wird für JEDE Kontoauswahl aus dem Verlauf JE SET rekonstruiert. Der
  // ist nicht kontogebunden, also gilt die Kurve auch für die Zeit vor einer
  // Verknüpfung.
  const p = require('./helpers/sources').portfolioQuelle();
  assert.doesNotMatch(p, /__portfolio__/,
    'Der Schnappschuss-Weg ist zurück — er kann weder rückwirkend rechnen ' +
    'noch den heutigen Bestand über die Zeit zeigen');
  assert.match(p, /GROUP BY s\.set_number/,
    'Dasselbe Set in zwei Konten darf nicht doppelt in die Summe');
  assert.match(p, /FROM price_history ph/,
    'Die Kurve muss aus dem Preisverlauf je Set entstehen');
});

test('Verschieben läuft über die Tagesregel, nicht über UPDATE user_id', () => {
  // Ein direktes UPDATE hinterliesse im Zielkonto zwei Erfassungen desselben
  // Tages — genau den Zustand, den der Bearbeiten-Pfad ablehnt.
  const mv = read('utils/setMove.ts');
  assert.ok(mv.includes("recordAcquisitionForDay('set', toId, [sn]"),
    'Erfassungen müssen einzeln über den gemeinsamen Helfer wandern');
  assert.doesNotMatch(mv, /UPDATE set_acquisitions SET user_id/,
    'Kein direktes Umhängen der Erfassungen');
  assert.ok(mv.includes('UPDATE sets SET quantity = quantity + $1'),
    'Besitzt das Zielkonto das Set schon, werden Mengen addiert');

  // Der Wechsel des ganzen Sets liegt seit Nachtrag 74 in der v1-Fabrik.
  const src = read('routes/api_v1/sets.ts');
  assert.ok(src.includes('withInventoryLock(fromId, sn'), 'Serialisiert über das Quellkonto');
  // Ganzes Set und einzelne Kaufpreise laufen durch DIESELBE Umsetzung — der
  // Teilfall ist kein Sonderweg, sondern der allgemeine Fall mit Auswahl.
  //
  // Seit Nachtrag 70 zählen wir über BEIDE Dateien: Die Erfassungs-Routen
  // wurden aus routes/sets.ts entfernt und leben nur noch in der v1-Fabrik,
  // die jetzt Webapp UND App bedient. Vorher standen beide Aufrufe in einer
  // Datei; die Regel („beide Wege nutzen denselben Helfer") ist unverändert,
  // nur ihr Ort hat sich geändert.
  const acq = read('routes/api_v1/acquisitions.ts');
  const calls = (src.match(/moveSetBetweenAccounts\(tx, sn/g) || []).length
              + (acq.match(/moveSetBetweenAccounts\(tx, sn/g) || []).length;
  assert.ok(calls >= 1,
    'Der Eigentümerwechsel muss über moveSetBetweenAccounts laufen — in routes/sets.ts ' +
    '(ganzes Set) oder in der gemeinsamen Fabrik (einzelne Kaufpreise)');
});

test('Schreiben in ein fremdes Konto verlangt die richtige Richtung', () => {
  // canWriteFor() prüft Hauptkonto → eigenes Unterkonto. „Steht im Blickfeld"
  // genügt NICHT: Ein Unterkonto darf nicht ins Nachbarkonto schreiben.
  //
  // Die Auflösung liegt in utils/household.ts, nicht in den Routen: Drei
  // Kopien einer Rechteprüfung sind die Sorte Doppelung, bei der irgendwann
  // eine grosszügiger ist als die anderen.
  const h = read('utils/household.ts');
  assert.match(h, /export async function resolveWriteTarget/);
  assert.match(h, /return \(await canWriteFor\(actorId, target\)\) \? target : null;/);
  // Ohne Angabe bleibt es beim eigenen Konto — alles verhält sich wie bisher.
  assert.match(h, /if \(requested === undefined \|\| requested === null \|\| requested === ''\) return actorId;/);

  // Alle drei Anlege-Pfade benutzen sie — Sets, manuelle Teile, Minifiguren.
  // Für Minifiguren liegt der Schreibpfad seit Nachtrag 72 in der gemeinsamen
  // Fabrik — deshalb steht dort routes/api_v1/minifigs.ts statt der entfernten
  // Session-Route. Geprüft wird dieselbe Regel am neuen Ort.
  for (const f of ['routes/sets.ts', 'routes/api_v1/parts.ts', 'routes/api_v1/minifigs.ts']) {
    const src = read(f);
    assert.match(src, /resolveWriteTarget\(/, `${f}: Kontoauswahl fehlt`);
    assert.match(src, /=== null\)[\s\S]{0,120}sendeFehler\(req, res, 403/,
      `${f}: Ohne Recht muss die Antwort 403 sein, nicht stillschweigend das eigene Konto`);
  }
});

test('manuelle Teile und Minifiguren tragen den Besitzer', () => {
  // Anders als Sets werden sie NICHT verdichtet: Zwei Konten mit demselben
  // Teil sind zwei Bestände mit eigener Menge und eigenem Kaufpreis, und jeder
  // Bearbeiten-Weg führt auf genau eine Zeile. Ohne Plakette sähe die Liste
  // wie eine doppelte Zeile aus.
  const h = require('./helpers/sources').handlerQuelle();
  // Auf die Parameter geprüft, nicht auf den Wortlaut: `rows: any[]` eines Tages
  // zu `rows: Row[]` zu schärfen ist eine Verbesserung und darf hier nicht als
  // Fehler erscheinen (siehe pruefeParameter() im Helfer).
  pruefeParameter(h, 'withOwners', ['uids', 'rows']);
  assert.match(h, /if \(uids\.length < 2 \|\| !rows\?\.length\) return rows;/,
    'Im Einzelkonto darf keine Plakette erscheinen');
  assert.match(h, /SELECT id, user_id, part_number/,
    'Ohne user_id in der Abfrage gibt es keinen Besitzer');

  const fc = read('utils/financeCalc.ts');
  pruefeParameter(fc, 'withOwnerNames', ['uids', 'rows']);
  const uses = (fc.match(/await withOwnerNames\(uids, await parallelLimit\(tasks, 5\)\)/g) || []).length;
  assert.equal(uses, 2, 'Teile- und Minifiguren-Bewertung brauchen beide den Besitzer');
});

test('die Teile-Zusammenfassung trägt auch über mehrere Konten', () => {
  // Die Tabelle ist JE KONTO aufgebaut. Für den Haushalt wird über alle
  // beteiligten Konten gelesen und über part_key verdichtet — dasselbe Teil in
  // zwei Konten ergibt EINE Zeile mit der Summe, genau wie dasselbe Teil aus
  // zwei Sets innerhalb eines Kontos.
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(h, /const groupSql = multi \? ' GROUP BY part_key, color_id' : '';/,
    'Ohne Gruppierung erschiene dasselbe Teil je Konto einmal');
  assert.match(h, /SELECT 1 FROM parts_summary WHERE \$\{where\} GROUP BY part_key, color_id/,
    'Auch die Gesamtzahl muss Teile zählen, nicht Konten');
  assert.match(h, /COUNT\(DISTINCT ps\.part_key\)::int AS unique_parts/,
    'COUNT(*) zählte im Haushalt Konten statt Teile — und ::int muss bleiben, ' +
    'sonst hängt der JSON-Typ am Zweig (Nachtrag 31: SUM(BIGINT) käme als Zahl, ' +
    'SUM(INTEGER) als Text)');

  // Frisch ist die Sicht nur, wenn sie es für JEDES Konto ist — „zwei von drei
  // sind aktuell" ergäbe eine Summe aus frischen und alten Beständen.
  const ps = read('utils/partsSummary.ts');
  assert.match(ps, /const results = await Promise\.all\(ids\.map\(id => ensureFresh\(id, opts\)\)\);/);
  assert.match(ps, /return results\.every\(Boolean\);/);
});

test('die Oberfläche zeigt Besitzer und Kontoauswahl nur im Haushalt', () => {
  // Im Einzelkonto stünde an jeder Kachel „gehört mir" — reines Rauschen.
  const gal = read('public/js/02-gallery.js');
  assert.match(gal, /export function ownerBadges/);
  assert.match(gal, /if \(!item\?\.owners\?\.length\) return '';/);
  // Eine Auswahl mit einer einzigen Möglichkeit ist keine Auswahl.
  assert.match(gal, /if \(members\.length < 2\) \{ box\.style\.display = 'none'; continue; \}/);
  // Alle drei Erfassen-Formulare bekommen dieselbe Liste — Set, manuelles
  // Teil, manuelle Minifigur. Vorher war die Kontoauswahl nur bei Sets da.
  // Seit Nachtrag 66 sind es VIER Formulare — der Katalog-Dialog („In Galerie
  // aufnehmen") war als einziger nicht angeschlossen und erfasste immer aufs
  // eigene Konto. Der Test pinnt deshalb nicht mehr die Liste als Ganzes,
  // sondern jeden Erfassungsweg einzeln: So wird er rot, wenn einer FEHLT,
  // aber nicht, wenn ein weiterer dazukommt.
  for (const feld of ['add-owner', 'ap-owner', 'af-owner', 'cat-m-owner']) {
    assert.ok(gal.includes(`'${feld}'`),
      `Die Kontoauswahl fehlt im Erfassungsweg ${feld} — dort landet dann alles ` +
      'stillschweigend beim eigenen Konto');
  }
  assert.match(gal, /\['add-owner', 'ap-owner', 'af-owner'/,
    'Die Kontoauswahl gehört in alle drei Erfassen-Formulare');
  const fig = read('public/js/06-minifigs.js');
  assert.match(fig, /owner_user_id: selectedOwner\('ap-owner'\)/);
  assert.match(fig, /owner_user_id: selectedOwner\('af-owner'\)/);
  // Und die Besitzer-Plakette auf den manuellen Kacheln.
  assert.match(fig, /\$\{ownerBadges\(p\)\}/);
  assert.match(fig, /\$\{ownerBadges\(f\)\}/);
  // Der Verschieben-Kasten im Set-Dialog ist entfernt: Verschoben wird über
  // den KAUFPREIS, Zeile für Zeile. Geprüft wird jetzt, dass die
  // Eigentümer-Spalte im Kaufpreis-Dialog nur im Haushalt erscheint — und
  // zwar in BEIDEN Dialogen (Sets und manuelle Einträge).
  const adm = require('./helpers/sources').adminQuelle();
  assert.doesNotMatch(adm, /renderMoveBox|moveSetToAccount/,
    'Das ganze Set darf nicht mehr auf einmal verschoben werden');
  const ownerCols = (adm.match(/_householdMembers\.length > 1 \? th\(t\('household\.owner'\)\) : ''/g) || []).length;
  assert.equal(ownerCols, 2,
    'Eigentümer-Spalte fehlt in einem der beiden Kaufpreis-Dialoge');
});

test('der Kontofilter gilt je Ansicht und wird überall mitgeschickt', () => {
  // Wer in der Galerie den ganzen Haushalt sieht, will in den Finanzen
  // womöglich nur die eigenen Zahlen — deshalb je Ansicht ein eigener Wert.
  const core = require('./helpers/sources').coreQuelle();
  assert.match(core, /export const SCOPE_VIEWS = \['gallery', 'parts', 'minifigs', 'finance'\];/);
  assert.match(core, /localStorage\.getItem\('bim_scope_' \+ view\)/,
    'Die Wahl soll einen Neuladen überleben');
  // 'all' ist die Vorgabe des Servers und wird weggelassen.
  assert.match(core, /if \(m && m !== 'all'\) p\.set\('accounts', m\);/);

  // Jede der vier Ansichten hängt ihn an ihre Abfragen.
  assert.match(read('public/js/02-gallery.js'), /addScopeParam\(p, 'gallery'\)/);
  assert.match(read('public/js/03-parts.js'),   /addScopeParam\(p, 'parts'\)/);
  assert.match(read('public/js/06-minifigs.js'), /addScopeParam\(p, 'minifigs'\)/);

  // Im Finanzreiter ALLE vier Abfragen — sonst stünde eine Summe aus einem
  // Blickfeld neben einer Aufstellung aus einem anderen.
  const fin = read('public/js/04-finance.js');
  // Adressen seit Etappe 5 unter /v1 — die Regel ist unverändert: ALLE vier
  // Abfragen des Reiters tragen denselben Filter.
  for (const ep of ['/v1/finance/valuation', '/v1/finance/parts-valuation',
                    '/v1/finance/minifigs-valuation', '/v1/finance/pnl']) {
    assert.ok(fin.includes(`'${ep}'+scopeQuery('finance')`), `${ep} ohne Kontofilter`);
  }
  assert.match(fin, /portfolio-history\?period=\$\{_chartPeriod\}\$\{scopeMode\('finance'\)/,
    'Auch die Kurve muss dem Filter folgen');
});

test('der Umschalter lädt nur die betroffene Ansicht neu', () => {
  // Alle vier gleichzeitig neu zu laden würde drei Ansichten anfassen, die
  // niemand ansieht — und dabei Preisabrufe auslösen.
  const gal = read('public/js/02-gallery.js');
  assert.match(gal, /export function onScopeChange\(view\)/);
  assert.match(gal, /if \(view === 'finance'\)  loadFinance\(\);/);
  // Die Reiter Teile und Minifiguren haben ZWEI Listen — die aus Sets und die
  // manuell erfassten. Der manuelle Bereich lädt über einen eigenen Endpunkt
  // und blieb sonst ungefiltert stehen.
  assert.match(gal, /if \(view === 'parts'\)    \{ loadParts\(\); loadManualParts\(\); \}/);
  // Und er erscheint nur bei einem Hauptkonto mit Unterkonten.
  assert.match(gal, /if \(!isMain\) \{ el\.style\.display = 'none'; continue; \}/);
  assert.match(gal, /initScopeSelects\(members\);/);
  // Ein Eintrag je Unterkonto, namentlich.
  assert.match(gal, /subs\.map\(m => `<option value="\$\{m\.id\}">/,
    'Die Auswahl muss jedes Unterkonto einzeln führen');
});

test('beim Verschieben wandert der Inhalt des Sets mit', () => {
  // Teile und Minifiguren gehören zum Set, nicht zum Konto. Blieben sie
  // zurück, hätte das Quellkonto Teile aus einem Set, das es nicht mehr
  // besitzt — sichtbar in der Teileliste, aber ohne Herkunft.
  const mv = read('utils/setMove.ts');
  for (const t of ['parts', 'minifigs', 'instructions']) {
    assert.ok(mv.includes(`INSERT INTO ${t}`), `${t} wandern nicht mit`);
  }
  // KOPIEREN, nicht umhängen: Bei einer Teilverschiebung behält der Absender
  // Exemplare — und damit auch deren Teile.
  assert.doesNotMatch(mv, /UPDATE parts SET user_id/,
    'Ein Umhängen liesse den Absender mit Exemplaren ohne Teile zurück');
  // Erst wenn dort das letzte Exemplar geht, wird beim Absender aufgeräumt.
  // Bei einer Teilverschiebung steht danach ALLES in beiden Konten: Der
  // Absender behält Set, Teile und Anleitungen, das Ziel bekam Kopien.
  const teil = mv.slice(mv.indexOf('if (remaining > 0)'), mv.indexOf('// Letztes Exemplar'));
  assert.ok(teil.includes('UPDATE sets SET quantity=$1'),
    'Bei einer Teilverschiebung sinkt beim Absender nur die Stückzahl');
  assert.doesNotMatch(teil, /DELETE FROM/,
    'Im Teilfall darf beim Absender nichts gelöscht werden');
  assert.ok(mv.includes("DELETE FROM ${t} WHERE user_id=$1 AND set_number=$2 AND COALESCE(source,'set') <> 'manual'"),
    'Beim Aufräumen dürfen manuelle Einträge nicht mit weg');
  const guards = (mv.match(/COALESCE\(source,'set'\) <> 'manual'/g) || []).length;
  assert.ok(guards >= 3, `nur ${guards} Schutzklauseln gegen manuelle Einträge`);
  // Geprüft wird JE TABELLE, ob das Ziel schon Zeilen hat — nicht, ob es das
  // Set hat. Ein Set ohne Teile ist möglich; wer vom Set schliesst, kopiert
  // dann nichts und löscht danach beim Absender.
  //
  // Auf die AUSSAGE geprüft, nicht auf die Schreibweise: Die Prüfungen liefen
  // ursprünglich per Promise.all über ein Array — das musste weichen, weil
  // parallele Abfragen auf einer Transaktionsverbindung nicht zulässig sind
  // (siehe test/set-move-db.test.js). Die alte Fassung verlangte wörtlich
  // `const [hasParts, hasFigs, hasInstr]` und wurde durch die Korrektur rot,
  // obwohl sich an der geprüften Regel nichts geändert hat.
  for (const name of ['hasParts', 'hasFigs', 'hasInstr']) {
    assert.ok(new RegExp(`${name}\\b`).test(mv), `${name} fehlt`);
  }
  for (const t of ['parts', 'minifigs', 'instructions']) {
    assert.ok(mv.includes(`has('${t}')`), `keine eigene Prüfung für ${t}`);
  }
});

test('Verschieben geht NUR über den Kaufpreis', () => {
  // Ein Set als Ganzes zu verschieben klingt bequem, verdeckt aber, was
  // tatsächlich wandert: Drei Erfassungen sind drei Käufe, die im Haushalt
  // verschiedenen Kindern gehören können. Wer alles verschieben will, ändert
  // jede Zeile — und sieht dabei, wie viele es sind.
  // Nur noch die Fabrik: Die /move-Route der Webapp ist mit Nachtrag 74
  // entfallen, beide Clients nutzen dieselbe. Regel unverändert.
  for (const f of ['routes/api_v1/sets.ts']) {
    const src = read(f);
    assert.match(src, /if \(!acqIds\.length\)\s*\n\s*return sendeFehler\(req, res, 400/,
      `${f}: move ohne acquisition_ids muss abgelehnt werden`);
  }

  // Und die Oberfläche bietet es gar nicht erst an.
  assert.doesNotMatch(require('./helpers/sources').adminQuelle(), /renderMoveBox|moveSetToAccount/);
  assert.doesNotMatch(read('public/index.html'), /m-move-box/);
});

test('auch manuelle Teile und Minifiguren wandern über den Kaufpreis', () => {
  // Dieselbe Regel für alle drei Arten. Ein manuell erfasstes Teil hat keinen
  // Inhalt — es wandern nur Menge und Erfassung.
  const mv = read('utils/setMove.ts');
  assert.match(mv, /export async function moveManualAcquisition/);
  assert.match(mv, /recordAcquisitionForDay\(kind, toId, keyValues/,
    'Auch hier gilt: eine Tageszeile je Konto');

  // Nachtrag 70: Die Erfassungs-Routen stehen nur noch in der v1-Fabrik, die
  // jetzt Webapp UND App bedient. Die Regel gilt unverändert — sie wird nur an
  // EINER Stelle geprüft statt an dreien, weil es nur noch eine gibt.
  for (const [f, kind] of [['routes/api_v1/acquisitions.ts', 'part'], ['routes/api_v1/acquisitions.ts', 'fig']]) {
    const src = read(f);
    assert.ok(src.includes(`moveManualAcquisition(tx, '${kind}'`), `${f}: Wechsel fehlt`);
    assert.match(src, /if \(to === null\)\s*\n\s*return sendeFehler\(req, res, 403/,
      `${f}: ohne Schreibrecht muss 403 kommen`);
  }
});

test('der Absender eines Eigentümerwechsels kommt aus der ZEILE, nicht aus dem Request', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Die Webapp schickte als from_user_id den BETRACHTER mit (_acqOwnerId ist
  // die Dialog-Ebene, der Zeilen-Eigentümer stand nur im Select der Anzeige).
  // Zog das Hauptkonto die Zeile eines Unterkontos zu sich, suchte der Server
  // sie unter dem falschen Konto und antwortete 404 „Kaufpreis nicht
  // gefunden" — die Android-App machte es richtig (acq.ownerUserId), die
  // Webapp nicht. Die Erfassungs-ID ist eindeutig; wem sie gehört, weiss die
  // Datenbank besser als jeder Dialog.
  const h = read('utils/household.ts');
  assert.match(h, /export async function acquisitionMoveSource/,
    'Die Auflösung gehört an die eine Stelle, die „wessen Daten?" beantwortet');
  assert.match(h, /canWriteFor\(actorId, owner\)/,
    'Auch der abgeleitete Absender braucht die Richtungsprüfung');

  // Der Eigentümer-Zweig leitet den Absender aus der ZEILE ab.
  //
  // Bis Nachtrag 70 gab es ihn VIERMAL (drei Session-Routen plus v1-Fabrik) —
  // und genau diese Vervierfachung war das Problem: Jede Kopie konnte
  // auseinanderlaufen, und mehrfach ist sie es auch. Seit dem Zusammenlegen
  // bedient die Fabrik beide Clients, also gibt es nur noch eine Stelle. Der
  // Test prüft dieselbe Regel, nur nicht mehr an vier Orten.
  assert.ok(read('routes/api_v1/acquisitions.ts').includes('acquisitionMoveSource(uid,'),
    'Eigentümer-Zweig leitet den Absender nicht aus der Zeile ab');
  // Gegenrichtung: In den Session-Routen darf KEINE zweite Fassung
  // zurückkehren — sonst hätten wir die Doppelung wieder.
  for (const f of ['routes/sets.ts', 'routes/parts.ts', 'routes/minifigs.ts']) {
    assert.ok(!read(f).includes("/acquisitions/:id'"),
      `${f}: Erfassungs-Routen sind wieder doppelt vorhanden — sie gehören nur in die Fabrik`);
  }
  // … und keiner vertraut mehr einem mitgeschickten from_user_id. Das Muster
  // `from_user_id ?? uid` bleibt NUR in den beiden /move-Routen erlaubt
  // (mehrere IDs, ausdrücklich benannter Absender).
  for (const f of ['routes/parts.ts', 'routes/minifigs.ts', 'routes/api_v1/acquisitions.ts']) {
    assert.ok(!read(f).includes('from_user_id ?? uid'),
      `${f}: der Eigentümer-Zweig darf den Request-Absender nicht übernehmen`);
  }

  // Die Webapp schickt gar kein from_user_id mehr — was der Server ohnehin
  // ignoriert, soll auch nicht mehr im Request stehen.
  assert.ok(!require('./helpers/sources').adminQuelle().includes('body.from_user_id'),
    '07-admin.js: from_user_id wird wieder mitgeschickt — der Server leitet den Absender selbst ab');
});

test('die App-Routen kennen den Eigentümerwechsel', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Die Android-App schickte owner_user_id an die v1-PUT-Routen — die Fabrik
  // las aber nur Menge, Preis und Zustand. Die Anfrage lief als LEERES Update
  // durch und antwortete success:true: Der Wechsel in der App war ein
  // stiller No-op, ohne Fehlermeldung und ohne Bewegung.
  const v1 = read('routes/api_v1/acquisitions.ts');
  assert.match(v1, /req\.body\?\.owner_user_id/,
    'Die v1-Fabrik muss owner_user_id auswerten');
  assert.match(v1, /moveSetBetweenAccounts\(tx, keys\[0\], from, to, \[id\]\)/,
    'Sets wandern über dieselbe Umsetzung wie in der Session-Route');
  assert.match(v1, /moveManualAcquisition\(tx, 'part', keys, id, from, to\)/);
  assert.match(v1, /moveManualAcquisition\(tx, 'fig', keys, id, from, to\)/);
});
