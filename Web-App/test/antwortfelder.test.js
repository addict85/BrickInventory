/**
 * Kein Antwortfeld ohne Verbraucher.
 *
 * Die Regel selbst steht in scripts/check-antwortfelder.js — dort, weil sie
 * auch von Hand aufrufbar sein soll und weil sie über die Ablagengrenze in die
 * Android-App hineinschaut. Dieser Test führt sie im normalen Lauf mit aus;
 * ohne ihn wäre sie ein Skript, das niemand startet.
 *
 * Gegenproben (durchgeführt):
 *   a) `rate_limit_neu` in die Bewertungsantwort gelegt → rot.
 *   b) Die Ausnahme für `uptime_seconds` gestrichen → rot.
 *   c) Eine Ausnahme für einen Schlüssel eingetragen, den es nicht gibt → rot
 *      ("tote Ausnahme").
 *   d) Den Pfad zu den Verbrauchern verbogen → rot mit eigener Meldung. Das ist
 *      der wichtigste der vier: Ohne Verbraucherdateien gälte JEDES Feld als
 *      ungelesen, und eine Prüfung, die aus Versehen nichts findet, ist
 *      schlimmer als keine.
 *
 * Anzumerken: Gegenprobe b blieb beim ersten Versuch grün — nicht wegen der
 * Regel, sondern weil mein Patch sein Ziel verfehlte und `replace` ohne Treffer
 * still nichts tut. Deshalb prüft die Probe jetzt zuerst, dass es das Muster
 * überhaupt gibt.
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
    assert.fail(`${e.stdout || ''}${e.stderr || ''}`.trim() ||
      'check-antwortfelder.js ist fehlgeschlagen, ohne etwas zu melden');
  }
});
