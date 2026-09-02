/**
 * Bilder und PDFs verlangen ausnahmslos eine Anmeldung.
 *
 * ── Was vorher offen war ────────────────────────────────────────────────────
 * Set-Bilder liefen über `app.use('/images', express.static(IMAGES_DIR))` — also
 * ohne jede Prüfung. Die Begründung im Code lautete, es seien öffentliche
 * Katalogfotos, die dieselben CDNs ohnehin ausliefern.
 *
 * Für das einzelne Bild stimmt das. Für die SAMMLUNG nicht: Wer die Adressen
 * durchprobiert, liest ab, welche Sets jemand besitzt — und das ist der Teil,
 * der schützenswert ist. Teile- und Minifiguren-Bilder verlangten schon immer
 * eine Anmeldung; die Ungleichbehandlung war historisch, nicht begründet.
 *
 * Dieser Test hält fest, dass keine Datei aus dem Datenverzeichnis mehr ohne
 * Anmeldung erreichbar ist.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT   = path.join(__dirname, '..');
const read   = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SERVER = read('server.ts');
/**
 * Kommentare weg — der Erklärtext oben nennt express.static selbst.
 *
 * ── Warum das mehr braucht als zwei replace() ───────────────────────────────
 * Die frühere Fassung war `.replace(/\/\*[\s\S]*?\*\//g, '')`. Sie sieht harmlos
 * aus, hat aber einen Startpunkt mitten in einer ZEICHENKETTE: `'/images/*'`
 * enthält `/*`. Von dort frass sie alles bis zum nächsten `*​/` — und wie viel
 * das ist, hing davon ab, wo zufällig der nächste Blockkommentar stand.
 *
 * Aufgefallen ist es, als ein einziger neuer Inline-Kommentar (`catch { /*…*​/ }`)
 * weiter unten dazukam: Danach fand die Prüfung NULL Datei-Routen und meldete
 * „liefe ins Leere" — vier Sicherheitsprüfungen auf einmal, ohne dass sich an
 * der Sicherheit irgendetwas geändert hatte.
 *
 * Genau das ist der Schaden: Ein Sicherheitstest, der aus einem unbeteiligten
 * Grund rot wird, wird beim nächsten Mal übergangen.
 *
 * Der Ersatz läuft einmal durch den Text und merkt sich, ob er gerade in einer
 * Zeichenkette steht. Zeilenkommentare und Blockkommentare fallen weg,
 * Zeichenketten bleiben unangetastet.
 */
function ohneKommentare(src) {
  let out = '', i = 0, str = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (str) {                                   // in einer Zeichenkette
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === str) str = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { str = c; out += c; i++; continue; }
    if (c === '/' && n === '*') {                // Blockkommentar
      const e = src.indexOf('*/', i + 2);
      const bis = e < 0 ? src.length : e + 2;
      for (const ch of src.slice(i, bis)) if (ch === '\n') out += '\n';   // Zeilen erhalten
      i = bis; continue;
    }
    if (c === '/' && n === '/') {                // Zeilenkommentar
      const e = src.indexOf('\n', i);
      i = e < 0 ? src.length : e; continue;
    }
    out += c; i++;
  }
  return out;
}
const CODE   = ohneKommentare(SERVER);

test('kein statischer Mount liefert Dateien aus dem Datenverzeichnis aus', () => {
  // express.static kennt keine Anmeldeprüfung. Für PUBLIC_DIR ist das richtig
  // (CSS, JavaScript, Schriften), für IMAGES_DIR war es die Lücke.
  const mounts = [...CODE.matchAll(/express\.static\(([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
  assert.deepEqual(mounts, ['PUBLIC_DIR'],
    `express.static über: ${mounts.join(', ')} — nur PUBLIC_DIR darf ohne Anmeldung ausgeliefert werden`);
});

test('jede Datei-Route prüft die Anmeldung', () => {
  // Alle Routen, die Dateien aus data/ ausliefern. serveDataFile() prüft
  // intern (resolveUserId + Besitzerabgleich), deshalb zählt es als Prüfung.
  const routes = [...CODE.matchAll(/app\.get\(\s*(\[[^\]]*\]|'[^']*')\s*,\s*([\s\S]*?)\n\}\);/g)];
  const fileRoutes = routes.filter(m => /\/data\/|\/images\//.test(m[1]));
  assert.ok(fileRoutes.length >= 3, `Nur ${fileRoutes.length} Datei-Routen gefunden — Prüfung liefe ins Leere`);
  for (const m of fileRoutes) {
    const [, pattern, body] = m;
    assert.ok(/resolveUserId\(req\)|serveDataFile\(/.test(body),
      `${pattern}: keine Anmeldeprüfung`);
  }
});

test('der Platzhalter liegt ausserhalb von /images/', () => {
  // Er ist ein Build-Asset wie CSS und JavaScript und wird auch angezeigt,
  // wenn gar kein Bild vorhanden ist — unter /images/ hätte er die Regel
  // "alles hier verlangt Anmeldung" durchlöchert.
  assert.ok(fs.existsSync(path.join(ROOT, 'public', 'assets', 'set-placeholder.svg')),
    'public/assets/set-placeholder.svg fehlt');
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'images')),
    'public/images/ darf es nicht mehr geben — sonst überlagert es data/images/');

  const refs = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'public', 'js'))) {
    if (!f.endsWith('.js') || f === 'app.bundle.js') continue;
    const src = fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');
    if (src.includes('/images/set-placeholder')) refs.push(f);
  }
  if (read('public/index.html').includes('/images/set-placeholder')) refs.push('index.html');
  assert.deepEqual(refs, [], `Alte Platzhalter-Adresse in: ${refs.join(', ')}`);
});

test('Bilder werden privat gecacht, nicht öffentlich', () => {
  // `public` erlaubt einem Reverse-Proxy oder CDN, die Antwort zu behalten und
  // an andere auszuliefern. Bei anmeldepflichtigen Inhalten wäre das genau der
  // Weg, die Prüfung wieder auszuhebeln.
  const route = CODE.slice(CODE.indexOf("app.get('/images/*'"));
  assert.match(route.slice(0, 1500), /Cache-Control', 'private/,
    'Bilder hinter Anmeldung dürfen nicht public gecacht werden');
});

test('der PDF-Download verlangt einen Token', () => {
  const pdf = read('routes/api_v1/pdf.ts');
  assert.match(pdf, /router\.get\('\/sets\/partslist-pdf\/download\/:jobId', requireToken/,
    'Der PDF-Download muss requireToken tragen');
});

test('die Webapp ruft nie direkt ein CDN auf', () => {
  // ── Nutzerentscheidung ───────────────────────────────────────────────────
  // Alle Bildabrufe laufen über /api/img-proxy. Nicht aus Prinzip: Der Proxy
  // setzt die Kopfzeilen gegen Cloudflares Hotlink-Schutz, entpackt
  // komprimierte Antworten, hält Platten- und Negativ-Cache. Nichts davon
  // wirkt, wenn der Browser die CDN-Adresse selbst aufruft.
  //
  // Zwei Lecks gab es in imgUrl(): ein "Entpacken" von Proxy-Adressen für
  // Hosts ausser rebrickable.com, und ein Durchfallen absoluter Adressen am
  // Ende der Funktion. fullUrl() gab rohe CDN-Adressen ebenfalls unverändert
  // zurück.
  //
  // Bewusst OHNE Kommentar-Entferner geprüft: Der einfache Zeilenfilter
  // zerschneidet das Regex-Literal /^https?:\/\// (die beiden Schrägstriche
  // darin sehen aus wie ein Kommentaranfang) — genau die Zeile, um die es
  // hier geht. Stattdessen wird auf Muster geprüft, die in keinem Kommentar
  // vorkommen.
  const core = require('./helpers/sources').coreQuelle();

  assert.doesNotMatch(core, /^\s*const inner = decodeURIComponent/m,
    'Das Entpacken von Proxy-Adressen ist wieder da — damit lädt der Browser direkt vom CDN');

  const imgUrl = core.slice(core.indexOf('export function imgUrl'),
                            core.indexOf('export function fullUrl'));
  assert.ok(imgUrl.length > 0, 'imgUrl() nicht gefunden');
  assert.match(imgUrl, /if \(\/\^https\?/,
    'Absolute Adressen müssen unabhängig vom Host über den Proxy laufen');

  const fullUrl = core.slice(core.indexOf('export function fullUrl'),
                             core.indexOf('export function imgUrl') > core.indexOf('export function fullUrl')
                               ? core.indexOf('export function imgUrl')
                               : core.indexOf('export function fullUrl') + 900);
  assert.match(fullUrl, /api\/img-proxy\?url=/,
    'fullUrl() muss absolute Adressen ebenfalls über den Proxy leiten');
});

test('die SQL-Migrationen landen im Build', () => {
  // ── Woher dieser Test kommt ──────────────────────────────────────────────
  // scripts/build-ts.js verarbeitete nur .ts. Die Migrationen in
  // db/migrations/ sind .sql und landeten damit NIE in dist/ — und weil das
  // Laufzeit-Image ausschliesslich dist/ übernimmt, fand runMigrations() dort
  // gar kein Verzeichnis vor.
  //
  // Der Fehler war still: Die Datenbank behielt die alten Bildpfade, und der
  // davon abhängige (inzwischen entfernte) Dateiumzug ordnete jede Datei als
  // "verwaist" ein. Es sah aus, als sei die Umsortierung wirkungslos.
  //
  // Die Prüfung bleibt, obwohl 0002 weg ist: db/migrations/0001-baseline.sql
  // liegt weiterhin dort, und jede künftige Migration ist wieder eine .sql.
  const build = read('scripts/build-ts.js');
  assert.match(build, /ASSET_EXT/,
    'build-ts.js kopiert keine Nicht-TS-Dateien mit — .sql-Migrationen fehlen im Build');
  assert.match(build, /'\.sql'/, '.sql muss unter den mitkopierten Endungen stehen');
});

test('data-self-Handler nehmen das Element als ERSTES Argument', () => {
  // ── Woher dieser Test kommt ──────────────────────────────────────────────
  // Der Dispatcher (public/js/11-actions.js) baut die Argumentliste so:
  //     if (el.dataset.self === '1') args.push(el);
  //     for (const key of ['data-arg', …]) args.push(…);
  // Das Element kommt also VOR den data-arg-Werten.
  //
  // retryBricksetQueueEntry und deleteBricksetQueueEntry hatten die Signatur
  // (setNumber, btn) — verdreht. setNumber war damit das Knopf-Element: Die
  // Meldung lautete "[object HTMLButtonElement] wird erneut versucht", und die
  // Adresse zeigte auf einen Eintrag, den es nicht gibt. Der Knopf sah aus, als
  // täte er etwas, und traf nie den gemeinten Datensatz.
  const fs2 = require('node:fs');
  const jsDir = path.join(ROOT, 'public', 'js');
  const files = fs2.readdirSync(jsDir).filter(f => /^\d\d-/.test(f) && f !== '00-registry.js');
  const withSelfAndArg = new Set();
  for (const f of files) {
    const src = fs2.readFileSync(path.join(jsDir, f), 'utf8');
    for (const m of src.matchAll(/data-click="([A-Za-z_$][\w$]*)"[^>]*?data-arg=/g)) {
      const after = src.slice(m.index, m.index + 400);
      if (after.includes('data-self="1"')) withSelfAndArg.add(m[1]);
    }
  }
  assert.ok(withSelfAndArg.size > 0, 'Keine data-self+data-arg-Handler gefunden — Prüfung liefe ins Leere');

  const wrong = [];
  for (const f of files) {
    const src = fs2.readFileSync(path.join(jsDir, f), 'utf8');
    for (const name of withSelfAndArg) {
      const m = src.match(new RegExp(`function ${name}\\(([^)]*)\\)`));
      if (!m) continue;
      const first = m[1].split(',')[0].trim();
      // Das Element heisst in diesem Projekt durchgehend btn/el.
      if (!/^(btn|el)\b/.test(first)) wrong.push(`${name}(${m[1]})`);
    }
  }
  assert.deepEqual(wrong, [],
    `Element gehört an die erste Stelle: ${wrong.join(', ')}`);
});

test('Adressen auf den eigenen Server gehen nicht durch den Proxy', () => {
  // ── Woher dieser Test kommt ──────────────────────────────────────────────
  // Nach der Umstellung "jede absolute Adresse über /api/img-proxy" schlug der
  // Zoom fehl:
  //   GET /api/img-proxy?url=https%3A%2F%2F<server>%2Fimages%2Fsets%2F9396-1.jpg
  //   → 403
  //
  // Der Proxy lehnte zu Recht ab — seine Allowlist kennt nur die Bild-CDNs,
  // und ein Proxy, der auf sich selbst zeigt, wäre eine offene Weiterleitung.
  //
  // Die Adresse entstand, weil `imgEl.src` nicht den Attributwert liefert,
  // sondern die vom Browser AUFGELÖSTE absolute Adresse. Der Zoom greift
  // darauf zurück, wenn data-orig nur den Platzhalter trägt (#m-img im
  // Set-Detail). Die Kacheln waren nicht betroffen: Sie beziehen ihre
  // Adressen relativ aus den Vorlagen — deshalb fiel es nur beim Zoom auf.
  const vm   = require('node:vm');
  const src  = require('./helpers/sources').coreQuelle()
    .replace(/^export /gm, '').replace(/^import[^;]*;\s*$/gm, '');
  const ctx  = { console, encodeURIComponent, decodeURIComponent,
                 location: { origin: 'https://example.test' } };
  vm.createContext(ctx);
  vm.runInContext(src.slice(src.indexOf('function stripOwnOrigin'),
                            src.indexOf('function escHtmlAttr')), ctx);
  const { imgUrl, fullUrl } = vm.runInContext('({ imgUrl, fullUrl })', ctx);

  assert.equal(fullUrl('https://example.test/images/sets/9396-1_thumb.jpg'),
    '/images/sets/9396-1.jpg',
    'Eigene Adressen müssen als Pfad behandelt werden, nicht proxiert');
  assert.equal(imgUrl('https://example.test/images/sets/9396-1.jpg', true),
    '/images/sets/9396-1.jpg',
    'Auch imgUrl darf die eigene Adresse nicht in den Proxy stecken');

  // Fremde Hosts laufen weiterhin über den Proxy — das ist der Zweck der
  // Umstellung und darf durch diesen Fix nicht verlorengehen.
  assert.match(fullUrl('https://cdn.rebrickable.com/media/sets/9396-1.jpg'),
    /^\/api\/img-proxy\?url=/,
    'CDN-Adressen müssen weiterhin über das Backend laufen');
});

test('der Haushalt darf hochgeladene Anleitungen lesen — das Unterkonto nicht rückwärts', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // serveDataFile() verglich das erste Pfadsegment stur mit der eigenen ID.
  // Richtig, solange ein Konto für sich stand — nach dem Haushalt an zwei
  // Stellen falsch:
  //
  //   • getSet listet Anleitungen mit user_id = ANY(uids), also
  //     haushaltsweit. Das Hauptkonto SAH die Anleitung des Unterkontos und
  //     bekam beim Klick 403.
  //   • moveSetBetweenAccounts kopiert local_path wörtlich. Nach dem
  //     Verschieben gehörte die Zeile dem neuen Konto, der Pfad zeigte aber in
  //     den Ordner des alten — 403 auf die EIGENE Zeile.
  //
  // Gegen echte Daten nachgestellt (vorher/nachher):
  //   Hauptkonto liest Anleitung des Unterkontos   403 → 200
  //   Hauptkonto liest seine verschobene Zeile     403 → 200
  //   Unterkonto liest Datei des Hauptkontos       403 → 403   (unverändert)
  const fn = CODE.slice(CODE.indexOf('function serveDataFile'),
                        CODE.indexOf('// Geteilte Bauanleitungen'));
  assert.match(fn, /scopeIds\(userId\)/,
    'Wessen Daten jemand sehen darf, beantwortet utils/household.ts — nicht der Dateipfad');
  assert.match(fn, /erlaubt\.includes\(besitzer\)/,
    'Geprüft wird gegen die Liste des Haushalts, nicht gegen „irgendwer"');
  assert.doesNotMatch(fn, /parseInt\(segments\[0\]\) !== userId/,
    'Der starre Vergleich mit der eigenen ID ist die Ursache, nicht die Lösung');
  // Die Asymmetrie hängt an scopeIds: Ein Unterkonto hat nur sich selbst im
  // Blickfeld (resolveHousehold), kommt also nicht an die Uploads des
  // Hauptkontos. Hier festgehalten, damit niemand auf memberIds des MAIN
  // umstellt.
  const hh = fs.readFileSync(path.join(ROOT, 'utils', 'household.ts'), 'utf8');
  assert.match(hh, /if \(!h\.isMain\) return h\.memberIds;/,
    'Ohne diese Zeile sähe ein Unterkonto plötzlich nach oben');
});

test('eine geteilte Anleitungsdatei überlebt, bis die letzte Zeile weg ist', () => {
  // Beim Verschieben eines Sets wird die Anleitungs-Zeile KOPIERT und der Pfad
  // wörtlich übernommen — zwei Konten teilen sich dann eine Datei. Das Löschen
  // stand VOR dem DELETE und fragte niemanden: Entfernte das eine Konto seine
  // Anleitung, zeigte die Zeile des anderen ins Leere, und im Set-Detail stand
  // ein Eintrag, der beim Klick 404 gibt.
  //
  // Nachgestellt: Kind löscht → Datei bleibt; Eltern löschen → Datei weg.
  const sets = require('./helpers/sources').setKernQuelle();
  const fn = sets.slice(sets.indexOf("router.delete('/:setNumber/instructions/:instrId'"),
                        sets.indexOf('// BrickInstructions PDF helpers'));
  assert.match(fn, /SELECT 1 AS ok FROM instructions WHERE local_path = \$1/,
    'Vor dem Löschen der Datei muss geprüft werden, ob noch jemand darauf zeigt');
  const idxDelete = fn.indexOf('DELETE FROM instructions');
  const idxUnlink = fn.indexOf('unlinkSync');
  assert.ok(idxDelete > 0 && idxDelete < idxUnlink,
    'Erst die eigene Zeile entfernen, dann zählen — sonst zählt man sich selbst mit');
});
