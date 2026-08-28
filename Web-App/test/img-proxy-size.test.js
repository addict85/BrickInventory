/**
 * Grosse CDN-Bilder landen im Cache und bekommen eine Vorschau.
 *
 * ── Woher dieser Test kommt (Marcos Fund, Nachtrag 43) ──────────────────────
 * Die Kachel für Set 60445-1 blieb leer, und der direkte Aufruf der
 * Proxy-Adresse mit `&thumb=1` lud „endlos", ohne das Bild je vollständig zu
 * zeigen. Die entscheidende Zahl stand in Marcos Netzwerk-Protokoll: 5'243 kB
 * übertragen — knapp ÜBER der damaligen 5-MB-Grenze des Cache-Zweigs.
 *
 * Die Grenze bricht nur den CACHE-Strom ab, nicht die Auslieferung. Die Folge
 * war deshalb nicht „kein Bild", sondern etwas Zäheres:
 *   • `aborted` verhindert das rename → die Datei landet NIE im Cache
 *   • queueThumb() steht hinter diesem rename → es entsteht NIE eine Vorschau
 *   • jede Kachel holt daraufhin bei JEDEM Aufruf erneut die vollen 5 MB
 * Für dieses eine Bild wiederholte sich das endlos — genau das sah der Nutzer.
 *
 * Zusätzlich geschah der Abbruch STILL: kein Logeintrag, kein Zähler. Ein
 * übergrosses Bild fiel damit in ein schwarzes Loch, in dem man ohne
 * Netzwerk-Protokoll nichts finden konnte.
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
  const fenster = code.slice(code.indexOf('PROXY_CACHE_MAX_BYTES && !aborted'));
  const block = fenster.slice(0, 800);
  assert.ok(/console\.error/.test(block),
    'ein übergrosses Bild muss eine Spur hinterlassen — sonst ist der Fall ohne ' +
    'Netzwerk-Protokoll des Nutzers nicht auffindbar');
  assert.ok(/imgProxyFailures/.test(block),
    'der Fall gehört in die Fehlerzählung der Diagnose-Endpunkte');
});

test('beide Bildgrenzen sind gleich gross — Proxy UND lokaler Download', () => {
  // ── Warum das zusammen geprüft wird (Nachtrag 47) ─────────────────────────
  // Nachtrag 43 hob nur die PROXY-Grenze an. Die zweite Grenze — die für das
  // lokal gespeicherte Set-Bild in routes/sets.ts — blieb bei 5 MB stehen, und
  // damit blieb Marcos Set weiter ohne lokales Bild: downloadSetImage()
  // liefert über der Grenze null, sets.image_local bleibt leer, generateThumb()
  // hat keine Datei zum Verkleinern, und beide Clients holen das Bild
  // weiterhin über den Proxy. Ein Weg repariert, der andere fiel weiter heraus.
  //
  // Deshalb hängen die beiden Zahlen ab jetzt aneinander.
  const proxy = /const PROXY_CACHE_MAX_BYTES = (\d+) \* 1024 \* 1024;/.exec(code);
  const setsSrc = fs.readFileSync(path.join(ROOT, 'utils/setImages.ts'), 'utf8');
  const lokal = /const SET_IMG_MAX_BYTES = (\d+) \* 1024 \* 1024;/.exec(setsSrc);
  assert.ok(proxy && lokal, 'eine der beiden Grenzen steht nicht mehr als benannte Konstante');
  assert.equal(Number(lokal[1]), Number(proxy[1]),
    `die Grenzen laufen auseinander: Proxy ${proxy[1]} MB, lokaler Download ${lokal[1]} MB. ` +
    'Dann bekommt ein Bild zwar einen Cache-Eintrag, aber keine lokale Datei — oder umgekehrt');
});

test('der lokale Download bricht nicht mehr still ab', () => {
  const setsSrc = fs.readFileSync(path.join(ROOT, 'utils/setImages.ts'), 'utf8');
  const i = setsSrc.indexOf('gelesen > SET_IMG_MAX_BYTES');
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
