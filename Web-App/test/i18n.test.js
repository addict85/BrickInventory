/**
 * i18n-Konsistenz: Deutsch und Englisch müssen exakt dieselben Schlüssel
 * haben (fehlende Übersetzungen fallen sonst erst im UI als roher Key auf),
 * und Platzhalter ({name}) müssen in beiden Sprachen übereinstimmen.
 *
 * Läuft ohne Browser: i18n.js wird in einem Sandbox-Kontext ausgeführt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Die Wörterbücher liegen seit der Aufteilung in public/locales/{de,en}.js —
// index.html lädt nur die aktive Sprache, den Rest holt loadLang() nach.
// Der Helfer setzt beide zusammen, damit hier unverändert geprüft werden kann.
const { loadTranslations } = require('./helpers/sources');

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = s => [...String(s).matchAll(PLACEHOLDER)].map(m => m[1]).sort();

test('DE und EN haben identische Schlüsselmengen', () => {
  const { de, en } = loadTranslations();
  const deKeys = Object.keys(de).sort();
  const enKeys = Object.keys(en).sort();
  const onlyDe = deKeys.filter(k => !(k in en));
  const onlyEn = enKeys.filter(k => !(k in de));
  assert.deepEqual(onlyDe, [], `Nur in DE vorhanden: ${onlyDe.join(', ')}`);
  assert.deepEqual(onlyEn, [], `Nur in EN vorhanden: ${onlyEn.join(', ')}`);
});

test('Platzhalter stimmen zwischen DE und EN überein', () => {
  const { de, en } = loadTranslations();
  for (const k of Object.keys(de)) {
    if (!(k in en)) continue; // wird vom Paritätstest gemeldet
    assert.deepEqual(placeholders(de[k]), placeholders(en[k]),
      `Platzhalter weichen ab bei "${k}": DE=${de[k]}  EN=${en[k]}`);
  }
});

test('Katalog-Schlüssel vorhanden', () => {
  const { de } = loadTranslations();
  for (const k of ['nav.catalog', 'catalog.title', 'catalog.filter.year_from',
                   'catalog.filter.year_to', 'catalog.buy_bricklink', 'catalog.add_to_gallery']) {
    assert.ok(k in de, `Schlüssel fehlt: ${k}`);
  }
});

test('Farbnamen werden im Deutschen übersetzt, die Daten bleiben englisch', () => {
  // Rebrickable liefert Farbnamen ausschliesslich englisch; sie stehen so in
  // der Datenbank und werden für BrickLink-Abfragen gebraucht. Übersetzt wird
  // deshalb nur die Anzeige.
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n.js'), 'utf8');
  assert.match(i18n, /function colorName\(en\)/, 'Übersetzer fehlt');
  assert.match(i18n, /if \(LANG !== 'de'\) return en;/,
    'In anderen Sprachen muss der Name unverändert bleiben');

  // Wortschatz statt Liste aller ~200 Farben: neue Farben ergeben automatisch
  // etwas Lesbares, unbekannte Wörter bleiben englisch.
  assert.match(i18n, /const COLOR_WORDS_DE = \{/, 'Wortschatz fehlt');
  assert.match(i18n, /const COLOR_PREFIX_DE = new Set/,
    'Ohne Zusammenschreibung entstünde „Dunkel Bläulich Grau"');

  // Der Filterwert muss englisch bleiben, sonst findet der Vergleich mit den
  // Daten nichts mehr.
  const parts = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '03-parts.js'), 'utf8');
  assert.match(parts, /data-arg="\$\{escHtml\(c\.color_name\)\}"/,
    'Der Filterwert darf nicht übersetzt werden');
  assert.match(parts, /activeColor===c\.color_name/,
    'Der Vergleich läuft über den englischen Namen');
  // Angezeigt wird übersetzt
  assert.ok(parts.includes('colorName(c.color_name)'), 'Filter-Beschriftung nicht übersetzt');
  assert.ok(parts.includes('colorName(p.color_name)'), 'Teile-Anzeige nicht übersetzt');
  assert.ok(parts.includes('colorName(g.color)'), 'Gruppenüberschrift nicht übersetzt');

  // KEINE angezeigte Farbe darf mehr roh durchgereicht werden. Genau das war
  // beim ersten Anlauf übersehen worden: Die Filterliste stand auf Deutsch,
  // die Gruppenüberschrift darüber weiter auf Englisch — und dieselben Stellen
  // gab es in Finanzen und Minifiguren.
  for (const f of ['03-parts.js', '04-finance.js', '06-minifigs.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
    const roh = [...src.matchAll(/esc\((\w+)\.color_name\)/g)]
      .filter(m => !src.slice(Math.max(0, m.index - 12), m.index).includes('colorName'));
    assert.deepEqual(roh.map(m => m[0]), [],
      `${f}: Farbname wird ohne colorName() angezeigt`);
  }
});

test('die Farbauswahl im Formular „Teil erfassen" zeigt deutsche Namen', () => {
  // data-name muss englisch bleiben — es wird beim Speichern als
  // parts.color_name übernommen und für BrickLink-Abgleiche gebraucht.
  // Übersetzt wird nur der sichtbare Options-Text.
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '06-minifigs.js'), 'utf8');
  const fn = src.slice(src.indexOf('function renderColorDropdown'),
                       src.indexOf('function renderColorDropdown') + 900);
  assert.match(fn, />\$\{esc\(colorName\(c\.name\)\)\}<\/option>/,
    'Der sichtbare Options-Text muss übersetzt werden');
  assert.match(fn, /data-name="\$\{esc\(\(c\.name\|\|''\)\.replace/,
    'data-name muss den englischen Namen behalten — er geht ans Backend');
});

test('thumbUrl() rät nicht mehr selbst — vertraut der Server-Antwort wie Android', () => {
  // Gleicher Fehler und derselbe Fix wie in der Android-App
  // (util/ImageUrls.kt, resolveThumbUrl()): utils/images.ts prüft bereits
  // serverseitig, ob "_thumb.jpg" existiert, und liefert je nachdem den
  // Thumb- oder den Original-Pfad. thumbUrl() konstruierte trotzdem seine
  // eigene "_thumb.jpg"-Adresse aus JEDEM lokalen Pfad — auch aus dem
  // Original, das der Server absichtlich zurückgegeben hatte, weil die
  // Vorschau fehlte. Das führte zu Bildern, die auch nach einem
  // vollständigen Neuladen der Seite nicht erschienen.
  const src = require('./helpers/sources').coreQuelle();
  const fn = src.slice(src.indexOf('function thumbUrl'), src.indexOf('function thumbUrl') + 200);

  assert.match(fn, /function thumbUrl\(src\) \{\s*return src;\s*\}/,
    'thumbUrl() muss eine reine Durchreiche sein, kein Rateversuch mehr');
  assert.doesNotMatch(fn, /_thumb\.jpg/,
    'Keine Konstruktion einer "_thumb.jpg"-Adresse mehr im Client');
});

test('Teile-Kacheln laden das Zoom-Bild über den Server-Proxy, nicht direkt vom CDN', () => {
  // Auf Nutzerwunsch: anders als bei Sets soll auch das Detailbild der Teile
  // durch das Backend laufen. data-orig speiste bisher die rohe (CDN-)Adresse
  // direkt, der Zoom lief damit am Server vorbei.
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '03-parts.js'), 'utf8');
  const fn = src.slice(src.indexOf('function partsCard('), src.indexOf('function partsCard(') + 900);
  assert.match(fn, /data-orig="\$\{escUrl\(rawSrc \? imgUrl\(fullUrl\(rawSrc\), false\) : ''\)\}"/,
    'data-orig muss über imgUrl(...) proxy-gewickelt sein, nicht die rohe Adresse');
});

test('die manuelle Teile-Kachel in 06-minifigs.js zeigt keine rohe CDN-Adresse mehr', () => {
  // Gefunden beim Umsetzen des vorigen Punkts: renderManualParts() lud das
  // Bild komplett unverarbeitet — einzige Stelle im Projekt ohne Vorschau
  // und ohne Proxy, obwohl es sich um eine gewöhnliche Kachel handelt.
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '06-minifigs.js'), 'utf8');
  const fn = src.slice(src.indexOf('function renderManualParts'));
  assert.doesNotMatch(fn, /const imgSrc = p\.image_local \|\| p\.image_url \|\| '';/,
    'Die rohe Zuweisung darf nicht mehr vorkommen');
  assert.match(fn, /const imgSrc = imgUrl\(thumbUrl\(p\.image_local \|\| p\.image_url\)/,
    'Muss wie jede andere Kachel über thumbUrl()/imgUrl() laufen');
});

test('der manuelle Kaufpreis-Detail-Dialog lädt Teile/Minifiguren-Bilder über den Proxy', () => {
  // Gemeldet: Detailbilder von Teilen/Minifiguren kamen weiterhin direkt vom
  // CDN. Der vorige Fix deckte nur den Kachel-Zoom ab (03-parts.js,
  // 06-minifigs.js) — dieser eigenständige Dialog (man-detail-img, geöffnet
  // beim Anklicken eines manuell erfassten Teils/einer Minifigur zum
  // Bearbeiten des Kaufpreises) hatte eine EIGENE, unabhängige Bildanzeige,
  // die nur fullUrl() ohne imgUrl()-Umwicklung benutzte — bei einer
  // CDN-Quelle also weiterhin ein direkter Browser-Zugriff.
  const src = require('./helpers/sources').adminQuelle();
  // Fenster grosszügig: Zwischen der Bild-Variablen und der Zuweisung stehen
  // inzwischen der Cache-Nachladepfad und Kommentare. Ein knapp bemessener
  // Ausschnitt macht die Prüfung von jeder Zeile abhängig, die jemand
  // dazwischen einfügt — und meldet dann einen Fehler, den es nicht gibt.
  const idx = src.indexOf("G('man-detail-img')");
  const fn = src.slice(idx, idx + 3000);
  assert.match(fn, /const imgSrc = rawImgSrc \? imgUrl\(fullUrl\(rawImgSrc\), false\) : '';/,
    'Das Bild muss über imgUrl(fullUrl(...), false) laufen, nicht über fullUrl(...) allein');
  assert.doesNotMatch(fn, /const imgSrc = fullUrl\(item\.image_url \|\| item\.image_local \|\| ''\);/,
    'Die alte, unproxierte Zuweisung darf nicht mehr vorkommen');
});

test('der Papierkorb im Brick-Design ist von Anfang an weiss hinterlegt, nicht erst beim direkten Überfahren', () => {
  // Gemeldet per Screenshot: Beim Überfahren der Kachel erschien der
  // Papierkorb nur schwach (rgba(255,255,255,.22)) — erst beim direkten
  // Überfahren DES KNOPFES wurde er voll weiss. Jetzt von Anfang an voll
  // weiss, sobald die Kachel selbst überfahren wird (die Sichtbarkeit des
  // gesamten .ca-Containers regelt bereits .sc:hover .ca in styles.css).
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'themes', 'brick.css'), 'utf8');
  const fn = src.slice(src.indexOf('[data-theme="brick"] .sc .delbtn{'),
                       src.indexOf('[data-theme="brick"] .qbadge'));
  assert.doesNotMatch(fn, /rgba\(255,255,255,\.22\)/,
    'Der schwache Ruhezustand darf nicht mehr vorkommen');
  assert.match(fn, /\[data-theme="brick"\] \.sc \.delbtn\{\s*background:#fff;/,
    'Der Ruhezustand muss bereits voll weiss hinterlegt sein');
});
