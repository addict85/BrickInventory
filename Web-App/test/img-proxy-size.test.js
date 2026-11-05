/**
 * Grosse CDN-Bilder landen im Cache und bekommen eine Vorschau.
 * Ausführlich: docs/begruendungen/test/img-proxy-size.test.js.md#kopf
 *
 * Gegenprobe (durchgeführt): Grenze zurück auf 5 MB → der erste Teilschritt
 * wird rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'routes/imgProxy.ts'), 'utf8');
const code = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

test('die Cache-Grenze deckt hochauflösende Katalogbilder ab', () => {
  const m = /const PROXY_CACHE_MAX_BYTES = (\d+) \* 1024 \* 1024;/.exec(code);
  assert.ok(m, 'die Grenze steht nicht mehr als benannte Konstante — sie war vorher als "5 * 1024 * 1024" mitten im Code versteckt');
  const mb = Number(m[1]);
  assert.ok(mb >= 10,
    `die Grenze liegt bei ${mb} MB. Marcos Bild übertrug 5'243 kB und fiel damit heraus: ` +
    'kein Cache, keine Vorschau, und jede Kachelanfrage holte die vollen Megabyte erneut');
});

test('der Abbruch wird protokolliert, nicht verschwiegen', () => {
  const i = code.indexOf('const verwirf = ');
  assert.ok(i > 0 && /bytes > PROXY_CACHE_MAX_BYTES\) \{ verwirf\(/.test(code), 'der Abbruch läuft nicht über verwirf()');
  const block = code.slice(i, i + 800);
  assert.ok(/console\.error/.test(block),
    'ein übergrosses Bild muss eine Spur hinterlassen — sonst ist der Fall ohne ' +
    'Netzwerk-Protokoll des Nutzers nicht auffindbar');
  assert.ok(/imgProxyFailures/.test(block),
    'der Fall gehört in die Fehlerzählung der Diagnose-Endpunkte');
});

test('beide Bildgrenzen sind gleich gross — Proxy UND lokaler Download', () => {
  // Warum das zusammen geprüft wird
  // Ausführlich: docs/begruendungen/test/img-proxy-size.test.js.md#proxy
  const proxy = /const PROXY_CACHE_MAX_BYTES = (\d+) \* 1024 \* 1024;/.exec(code);
  const setsSrc = fs.readFileSync(path.join(ROOT, 'src/katalog/bilder/setImages.ts'), 'utf8');
  const lokal = /const SET_IMG_MAX_BYTES = (\d+) \* 1024 \* 1024;/.exec(setsSrc);
  assert.ok(proxy && lokal, 'eine der beiden Grenzen steht nicht mehr als benannte Konstante');
  assert.equal(Number(lokal[1]), Number(proxy[1]),
    `die Grenzen laufen auseinander: Proxy ${proxy[1]} MB, lokaler Download ${lokal[1]} MB. ` +
    'Dann bekommt ein Bild zwar einen Cache-Eintrag, aber keine lokale Datei — oder umgekehrt');
});

test('der lokale Download bricht nicht mehr still ab', () => {
  const setsSrc = fs.readFileSync(path.join(ROOT, 'src/katalog/bilder/setImages.ts'), 'utf8');
  const i = setsSrc.indexOf("e.grund === 'zu-gross'");
  assert.ok(i > 0, 'die Grössenprüfung im Download fehlt');
  assert.ok(/console\.error/.test(setsSrc.slice(i, i + 500)),
    'ein übergrosses Bild muss eine Spur hinterlassen — vorher verschwand es wortlos');
});

test('die Vorschau hängt am erfolgreichen Cache-Schreiben', () => {
  // Diese Reihenfolge ist der Grund, warum die Grenze so weh tat: Wird der
  // Cache verworfen, entsteht auch keine Verkleinerung. Der Test hält die
  // Abhängigkeit fest, damit sie beim Umbauen nicht unbemerkt verschwindet.
  const rename = code.indexOf('rename(tmpFile, cacheFile)');
  const queue = code.indexOf('queueThumb(cacheFile, thumbFile)', rename);
  assert.ok(rename > 0, 'das atomare Umbenennen des Caches fehlt');
  assert.ok(queue > rename, 'queueThumb muss NACH dem rename stehen — vorher gäbe es die Quelldatei noch nicht');
});
