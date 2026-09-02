/**
 * Ein verschluckter SCHREIBVORGANG auf Nutzerdaten.
 *
 * ── Warum nur Schreibvorgänge, und nur auf Nutzerdaten ──────────────────────
 * Im Baum stehen knapp vierhundert `.catch(() => {})`. Die meisten sind
 * richtig: Auf einem SELECT heisst ein stiller catch „kein Wert", und ein
 * fehlgeschlagener Cache-Eintrag wird beim nächsten Mal neu geholt.
 *
 * Ein Schreibvorgang ist etwas anderes. Scheitert er still, fehlt die Zeile —
 * und niemand erfährt es, weder der Nutzer noch der Betreiber im Protokoll.
 *
 * Und nicht jeder Schreibvorgang wiegt gleich: Ein Vorschaubild, das nicht
 * entsteht, holt der Startlauf nach. Eine Zeile in `sets`, `parts`,
 * `minifigs`, den Erfassungstabellen, `users` oder `user_settings` holt
 * niemand nach — das sind die Daten, die der Nutzer selbst eingegeben hat.
 *
 * ── Der Fund, der die Grenze gezogen hat ────────────────────────────────────
 * `utils/setService.ts` legt beim Aufstocken eine eigene Set-Zeile an, falls
 * das Set bisher nur einem anderen Haushaltskonto gehörte. Der Kommentar dort
 * sagt: „sonst liefe die Mengenanpassung ins Leere." Genau das passierte,
 * wenn das INSERT scheiterte: Das UPDATE zwei Zeilen weiter traf null Zeilen,
 * die Mengenänderung war weg — und `adjustAcquisitionsToQuantity()` schrieb
 * die Erfassungen trotzdem. Erfassungen ohne Bestand, lautlos.
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────
 * Kein `.catch(() => {})`, `.catch(() => null)` oder `.catch(() => undefined)`
 * unmittelbar hinter einem INSERT/UPDATE/DELETE auf einer dieser Tabellen.
 * `logAndContinue(kontext)` ist der Weg; gar kein catch (Fehler weiterreichen)
 * ebenfalls.
 *
 * Die Stellen werden gefunden, nicht aufgezählt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Tabellen mit Daten, die der Nutzer selbst eingegeben hat. */
const NUTZERDATEN = [
  'sets', 'parts', 'minifigs',
  'set_acquisitions', 'part_acquisitions', 'minifig_acquisitions',
  'users', 'user_settings', 'account_links',
];

test('kein stiller catch auf einem Schreibvorgang mit Nutzerdaten', () => {
  /** @type {string[]} */
  const dateien = [];
  const sammle = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'coverage', 'public', 'test'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) sammle(p);
      else if (e.name.endsWith('.ts')) dateien.push(p);
    }
  };
  sammle(ROOT);
  assert.ok(dateien.length >= 60, `nur ${dateien.length} Dateien gefunden — der Pfad stimmt nicht`);

  // ── Warum hier geklammert und nicht nur ein Fenster gelesen wird ──────────
  // Der erste Entwurf nahm die sechs Zeilen vor dem catch und suchte darin ein
  // INSERT/UPDATE/DELETE. Das meldete vier Stellen, die keine sind: drei
  // KOMMENTARE, die erklären, warum der catch dort entfernt wurde, und ein
  // generateThumb(...).catch(), dem zufällig ein UPDATE vorausging.
  //
  // Jetzt wird vom Aufruf aus geklammert: db.run(/tx.run(/pool.query( mit einem
  // schreibenden SQL, dann bis zur schliessenden Klammer, und erst was DANN
  // folgt, zählt als dessen catch.
  const aufruf = /\b(?:db|tx|dbh|client)\.(?:run|query)\(|\bpool\.query\(/g;
  const stillDanach = /^\s*\)?\s*\.catch\(\s*\(?\s*_?\w*\s*\)?\s*=>\s*(\{\s*\}|null|undefined)\s*\)/;
  const schreib = new RegExp(
    `\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(${NUTZERDATEN.join('|')})\\b`, 'i');

  const ohneKommentare = (src) => src.split('\n')
    .map(z => { const t = z.trim(); return (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) ? '' : z; })
    .join('\n');

  const verstoesse = [];
  let geprueft = 0;
  for (const datei of dateien) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    aufruf.lastIndex = 0;
    let m;
    while ((m = aufruf.exec(src)) !== null) {
      // Bis zur schliessenden Klammer des Aufrufs
      let tiefe = 1, i = m.index + m[0].length;
      while (i < src.length && tiefe > 0) {
        const c = src[i];
        if (c === '(') tiefe++;
        else if (c === ')') tiefe--;
        i++;
      }
      const anweisung = src.slice(m.index, i);
      if (!schreib.test(anweisung)) continue;
      geprueft++;
      if (stillDanach.test(src.slice(i, i + 90))) {
        const zeile = src.slice(0, m.index).split('\n').length;
        verstoesse.push(`${path.relative(ROOT, datei)}:${zeile}`);
      }
    }
  }

  // Selbstbeweis: Findet das Muster keine schreibenden Aufrufe auf diesen
  // Tabellen, sagt ein leeres Ergebnis nichts.
  assert.ok(geprueft >= 30,
    `nur ${geprueft} schreibende Aufrufe auf Nutzerdaten gefunden — Muster veraltet`);

  assert.deepEqual(verstoesse, [],
    'Diese Schreibvorgaenge auf Nutzerdaten scheitern spurlos:\n  ' +
    verstoesse.join('\n  ') +
    '\nEntweder den Fehler weiterreichen (gar kein catch) oder ihn mit ' +
    'logAndContinue(kontext) protokollieren.');
});
