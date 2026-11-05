/**
 * Teileliste und Bilder: was der Server liefern muss (Seiten, Grenzen,
 * Kategorien, Vorschaubilder). Das Verhalten der Oberfläche beim Blättern
 * prüft test/listen-paging-oberflaeche.test.js in jsdom.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * import-/export-Syntax aus einer Moduldatei entfernen.
 *
 * Diese Tests werten den Quelltext in einer vm-Sandbox bzw. in jsdom als
 * KLASSISCHES Skript aus. Seit der Umstellung auf ES-Module enthalten die
 * Dateien import- und export-Anweisungen, die dort einen SyntaxError erzeugen
 * ("Cannot use import statement outside a module"). Die geprüfte Logik ändert
 * sich dadurch nicht — nur die Modulverpackung muss weg.
 *
 * @param {string} src
 * @returns {string}
 */
function stripModuleSyntax(src) {
  const body = src
    .replace(/^import[^;]*;\s*$/gm, '')   // import { a, b } from '…';
    .replace(/^export\s+/gm, '');          // export function/const/let/class
  // registerActions() kommt sonst aus js/00-registry.js und ist nach dem
  // Entfernen der Importe nicht definiert. In der Sandbox interessiert die
  // Anmeldung nicht — dass sie aufgerufen WIRD, prüfen test/csp-actions.test.js
  // und test/bundle-smoke.test.js gegen den echten Quelltext.
  // tRaw() lebt in i18n.js und wird hier nicht mitgeladen. In der Sandbox
  // genügt die Weiterleitung an t(): Der Unterschied liegt allein in der
  // Maskierung der eingesetzten Werte, die diese Tests nicht prüfen.
  return 'function registerActions() {}\n'
       + 'function tRaw(k, v) { return typeof t === "function" ? t(k, v) : k; }\n'
       + body;
}

const ROOT = path.join(__dirname, '..');
const SRC  = stripModuleSyntax(fs.readFileSync(path.join(ROOT, 'public', 'js', '03-parts.js'), 'utf8'));

test('nachgeladen wird nur im sichtbaren Teile-Tab', () => {
  const fn = SRC.slice(SRC.indexOf('function maybeLoadMoreParts'));
  assert.match(fn.slice(0, 400), /tab-parts[\s\S]{0,80}classList\.contains\('active'\)/,
    'sonst lädt der Sentinel im Hintergrund weiter, während der Nutzer woanders ist');
});

test('getParts liefert die Seiteninformationen mit', () => {
  const h = require('./helpers/sources').handlerQuelle();
  const ret = h.slice(h.indexOf("return { parts, total, source: 'db'"), h.indexOf("return { parts, total, source: 'db'") + 200);
  assert.match(ret, /total/, 'ohne total weiss der Client nicht, wann Schluss ist');
});

test('der Proxy kann verkleinern und tut es nur einmal je Bild', () => {
  const server = require('./helpers/sources').serverAll();
  assert.match(server, /req\.query\.thumb === '1'/, 'Der Proxy kennt kein thumb=1');
  assert.match(server, /_thumbInFlight/,
    'Ohne Zusammenfassung startet eine Kachelwand dieselbe Verkleinerung mehrfach');
  // Die Cache-Dauern wurden gesenkt und um must-revalidate ergänzt, nachdem
  // ein langes max-age kaputte Antworten im Browser festgenagelt hatte
  // („200 from disk cache"). Geprüft wird jetzt nur noch, dass eine
  // Rückfragepflicht gesetzt ist.
  assert.match(server, /must-revalidate/, 'Ohne Rückfragepflicht bleiben Fehler im Browser stehen');

  const core = stripModuleSyntax(require('./helpers/sources').coreQuelle());
  assert.match(core, /thumb \? '&thumb=1' : ''/, 'imgUrl() reicht den Wunsch nicht weiter');
});

test('alle Listenbilder laden verzögert', () => {
  // Ohne loading="lazy" startet der Browser sämtliche Bilder einer Liste
  // gleichzeitig und drängt sie durch die ~6 Verbindungen pro Host — sie
  // tröpfeln dann sichtbar herein. Bei den Minifiguren fehlte das Attribut an
  // drei von vier Stellen, in Finanzen an beiden.
  const dir = path.join(ROOT, 'public', 'js');
  const bad = [];
  for (const f of fs.readdirSync(dir).filter(x => /^\d\d-.*\.js$/.test(x))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/<img\s[^>]*>/g)) {
      const tag = m[0];
      if (!/\$\{/.test(tag)) continue;                    // kein dynamisches Bild
      if (/placeholder/.test(tag)) continue;              // lokales SVG, winzig
      if (/loading="lazy"/.test(tag)) continue;
      bad.push(`${f}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(bad, [], `Listenbilder ohne loading="lazy": ${bad.join(', ')}`);
});

test('Detailansicht und Zoom zeigen die volle Auflösung', () => {
  // Die Kacheln zeigen seit der Thumbnail-Umstellung eine verkleinerte Fassung.
  // Auf der Detailseite und im Zoom wäre die unscharf.
  const core = stripModuleSyntax(require('./helpers/sources').coreQuelle());
  assert.match(core, /function fullUrl/, 'Gegenstück zu thumbUrl() fehlt');

  const admin = stripModuleSyntax(require('./helpers/sources').adminQuelle());
  assert.match(admin, /img\.src=fullUrl\((curSet|set)\.image_local\|\|(curSet|set)\.image_url\)/,
    'Detailansicht der Galerie muss die volle Auflösung nehmen');

  const act = stripModuleSyntax(fs.readFileSync(path.join(ROOT, 'public', 'js', '11-actions.js'), 'utf8'));
  assert.match(act, /fullUrl\(src\)/, 'Der Zoom muss die volle Auflösung öffnen');
});

test('data-orig zeigt nie auf dieselbe Adresse wie src', () => {
  // Sonst holt der Fehler-Rückfall exakt dieselbe URL erneut.
  const figs = stripModuleSyntax(fs.readFileSync(path.join(ROOT, 'public', 'js', '06-minifigs.js'), 'utf8'));
  assert.doesNotMatch(figs, /src="\$\{escUrl\(imgSrc\)\}"[^>]*data-orig="\$\{escUrl\(imgSrc\)\}"/,
    'src und data-orig identisch — der Rückfall läuft ins Leere');
});

test('fehlende CDN-Bilder werden nicht endlos nachgefragt', () => {
  const server = require('./helpers/sources').serverAll();
  assert.match(server, /_imgNegCache/,
    'Ohne Negativ-Cache geht bei jedem Seitenaufruf ein Roundtrip für ein 404-Bild raus');
  // Nur 404: Ein 403 kommt beim CDN auch als Drosselung vor und darf nicht
  // für Minuten ausgesperrt werden (siehe „nur 404 wird negativ gecacht").
  assert.match(server, /if \(r\.status === 404\) \{/, '404 muss gemerkt werden');
});

test('Argumente aus data-arg werden als Zeichenkette behandelt', () => {
  // Der Dispatcher reicht data-arg immer als String. Handler, die damit
  // rechnen oder strikt vergleichen, müssen selbst umwandeln — sonst wird aus
  // 1 + "1" die Zeichenkette "11".
  const admin = stripModuleSyntax(require('./helpers/sources').adminQuelle());
  assert.match(admin, /\(parseInt\(delta\) \|\| 0\)/,
    'manQtyChange muss delta umwandeln');
  const settings = stripModuleSyntax(require('./helpers/sources').ansichtQuelle('05'));
  assert.match(settings, /isAdmin === true \|\| isAdmin === 1 \|\| isAdmin === '1'/,
    'toggleAdmin: !"0" ist false — das Umschalten wäre wirkungslos');
});

test('die Verkleinerung lässt keine Anfrage warten', () => {
  // Gemessen: Jimp braucht rund 150 ms je Bild und belegt dabei den
  // Event-Loop. Eine Kachelwand mit 60 Minifiguren ergäbe neun Sekunden, in
  // denen der Server für ALLE Anfragen steht.
  const server = require('./helpers/sources').serverAll();
  assert.match(server, /const THUMB_MAX_PARALLEL = \d+/,
    'Ohne Obergrenze laufen beliebig viele Verkleinerungen gleichzeitig');
  assert.match(server, /function queueThumb/, 'Warteschlange fehlt');
  // Im Ausliefer-Pfad darf nicht auf die Verkleinerung gewartet werden.
  // Dieser Pfad IST seit Nachtrag 135 src/katalog/bilder/imgCacheServe.ts — vorher ein
  // grosszügig geschnittenes Stück des Route-Rumpfs, was nach dem Umzug ins
  // Leere zeigte.
  const proxy = fs.readFileSync(
    path.join(ROOT, 'src/katalog/bilder/imgCacheServe.ts'), 'utf8');
  assert.doesNotMatch(proxy, /await makeProxyThumb/,
    'Eine wartende Anfrage reiht 150 ms je Bild aneinander');
  assert.match(proxy, /queueThumb\(cacheFile, thumbFile\)/,
    'Die Verkleinerung gehört in den Hintergrund');
});

test('der Farbfilter vergleicht Namen — in beiden Abfragepfaden', () => {
  // Die vorberechnete Zusammenfassung filterte über `color_id` und rechnete
  // `parseInt('Black')` → NaN. Die Bedingung traf auf nichts zu, und jeder
  // Klick auf eine Farbe endete in „Keine Teile gefunden". Der Live-Pfad
  // darunter vergleicht seit jeher über color_name — beide müssen dasselbe tun.
  const h = require('./helpers/sources').handlerQuelle();
  // getParts steht mit Typannotation im Code — auf den Namen ohne Signatur
  // schneiden, sonst ist der Abschnitt leer und der Test prüft nichts.
  const sum = require('./helpers/sources').funktionsRumpf(h, 'seiteAusZusammenfassung');
  assert.ok(sum.length > 100, 'Abschnitt nicht gefunden — Prüfung liefe ins Leere');
  assert.ok(sum.includes('cond.push(`color_name = $${params.length + 1}`)'),
    'Die Zusammenfassung muss über den Farbnamen filtern');
  assert.doesNotMatch(sum, /parseInt\(o\.color\)/,
    'parseInt auf einen Farbnamen ergibt NaN');
});

test('Kategorien werden über den Teilekatalog aufgelöst', () => {
  // parts.category_name enthält die Rebrickable-Kategorie-ID als Text — oder
  // 'Unknown', wenn die Set-Teile-Antwort kein part_cat_id mitliefert. Das ist
  // bei /sets/{id}/parts/ die Regel: Das eingebettete part-Objekt führt das
  // Feld meist nicht. Die Filterliste zeigte deshalb nur einen Eintrag.
  // Die Liste steht seit dem 29.10. in src/teile/abfragen.ts
  // (getPartsCategories), einmal für Zusammenfassung und Live-Abfrage.
  const parts = require('./helpers/sources').handlerQuelle();
  assert.match(parts, /LEFT JOIN rb_parts rp ON rp\.part_num = \$\{nummer\}/,
    'Die Kategorieliste muss über rb_parts auflösen');
  assert.match(parts, /LEFT JOIN rb_part_categories rp_cat ON rp_cat\.id = rp\.part_cat_id/,
    'Ohne den zweiten Join fehlt der Kategoriename');

  // Und der Filter muss dieselbe Auflösung benutzen, sonst findet ein Klick
  // auf eine aufgelöste Kategorie nichts.
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(h, /EXISTS \(SELECT 1 FROM rb_parts rp[\s\S]{0,160}rp\.part_cat_id::text = \$/,
    'Der Live-Filter muss die Kategorie ebenfalls über rb_parts auflösen');

  // Die Zusammenfassung löst seit dem 29.10. genauso über rb_parts auf; dass
  // beide Wege dasselbe liefern, prüft test/teile-kategorie-zusammenfassung-db.
  const sum = require('./helpers/sources').funktionsRumpf(h, 'seiteAusZusammenfassung');
  assert.ok(sum.length > 100, 'Abschnitt nicht gefunden — Prüfung liefe ins Leere');
  assert.match(sum, /part_number IN \(SELECT rp\.part_num FROM rb_parts rp/,
    'Die Zusammenfassung muss die Kategorie ebenfalls über rb_parts auflösen');
});

test('beide Abfragewege deckeln page_size gleich', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // getParts hat zwei Wege: die Live-Abfrage und die vorberechnete
  // Zusammenfassung. Nur der erste deckelte page_size (bei 500), der zweite
  // reichte den Wert ungeprüft ins LIMIT durch. DIESELBE Anfrage lieferte
  // damit unterschiedlich viele Zeilen, je nachdem ob die Zusammenfassung
  // gerade frisch war — an 5000 Teilen mit page_size=100000 gemessen:
  // 500 Zeilen über die Live-Abfrage, 5000 über die Zusammenfassung. Ein
  // Unterschied, der am Cache-Zustand hängt, ist beim Suchen eines Fehlers
  // das Letzte, was man vermutet — und nebenbei ein Weg, sich beliebig grosse
  // Antworten bauen zu lassen.
  const h = require('./helpers/sources').handlerQuelle();
  assert.match(h, /export const MAX_PAGE_SIZE = 500;/,
    'Die Obergrenze gehört an EINE Stelle');
  assert.match(h, /function clampPageSize/, 'Gemeinsamer Helfer fehlt');
  // Kein Literal mehr: Wer die Grenze ändert, ändert sie überall.
  assert.doesNotMatch(h, /Math\.min\(500,/,
    'Die 500 darf nicht wieder als Literal an einzelnen Stellen stehen');
  // Und der Weg, der sie NICHT hatte, deckelt jetzt ebenfalls.
  //
  // Geprüft wird die AUSSAGE, nicht der Aufruf von clampPageSize: Seit die
  // Teileliste eines einzelnen Sets eine höhere Grenze hat
  // (SET_PARTS_MAX_PAGE_SIZE, weil die App sie in einem Stück holt), rechnet
  // der Pfad die Grenze selbst aus. Entscheidend bleibt, dass BEIDE Wege
  // dieselben zwei Grenzen kennen und keiner den Wert ungeprüft durchreicht.
  const { funktionsRumpf } = require('./helpers/sources');
  const grenze = funktionsRumpf(h, 'seitengroesse');
  assert.match(grenze, /SET_PARTS_MAX_PAGE_SIZE : MAX_PAGE_SIZE/, 'Die Seitengrösse kennt die Grenzen nicht');
  assert.match(grenze, /Math\.min\(obergrenze/, 'page_size geht wieder ungeprüft durch');
  assert.match(funktionsRumpf(h, 'tryPartsSummary'), /seitengroesse\(/, 'Der Zusammenfassungs-Pfad kennt die Grenzen nicht');
  assert.match(funktionsRumpf(h, 'getParts'), /seitengroesse\(/, 'Der Live-Pfad kennt die Grenzen nicht');
});
