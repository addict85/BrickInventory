/**
 * Kein Antwortfeld ohne Verbraucher.
 *
 * Die Regel selbst steht in scripts/check-antwortfelder.js — dort, weil sie
 * auch von Hand aufrufbar sein soll. Was die App liest, nimmt sie aus
 * shared/app-schnittstelle.json. Dieser Test führt sie im normalen Lauf mit aus;
 * ohne ihn wäre sie ein Skript, das niemand startet.
 *
 * Gegenproben (durchgeführt):
 *   a) `rate_limit_neu` in die Bewertungsantwort gelegt → rot.
 *   b) Die Ausnahme für `db_pool` gestrichen → rot (27.10.; vorher `uptime_seconds`,
 *      das seit /health nur für Verwalter nicht mehr oben in einer Antwort steht).
 *   c) Eine Ausnahme für einen Schlüssel eingetragen, den es nicht gibt → rot
 *      ("tote Ausnahme").
 *   e) (11.11.2026) Seit Dienste ohne `success` antworten (die Route spreizt
 *      ihr Ergebnis), liest die Prüfung auch deren return: `feld_ohne_leser`
 *      im return von cacheStatistik() → rot.
 *   f) (14.11.2026) In shared/app-schnittstelle.json `"is_main"` aus den Antwortfeldern
 *      gestrichen → rot: OHNE VERBRAUCHER is_main.
 *   d) Den Pfad zu den Verbrauchern verbogen → rot mit eigener Meldung (ohne
 *      Verbraucher gälte JEDES Feld als ungelesen).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('kein Antwortfeld ohne Verbraucher', () => {
  const skript = path.join(__dirname, '..', 'scripts', 'check-antwortfelder.js');
  try {
    execFileSync(process.execPath, [skript], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    assert.fail(
      `${e.stdout || ''}${e.stderr || ''}`.trim() || 'check-antwortfelder.js ist fehlgeschlagen, ohne etwas zu melden',
    );
  }
});
