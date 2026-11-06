# Begründungen zu `test/set-erfassung-zustand-db.test.js`

Die ausführlichen Kommentare aus `test/set-erfassung-zustand-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Beim Aufstocken eines Sets müssen Preis und vermerkter Zustand ZUSAMMEN passen.

── Der Befund ──────────────────────────────────────────────────────────────
`addSet()` hat zwei Wege, und sie behandelten den fehlenden Zustand
verschieden:

  NEU angelegt (setService.ts:347/367)
    const effectiveCondition = condition || await userDefaultCondition(...)
    → Preis UND Erfassung bekommen denselben Zustand.

  AUFGESTOCKT (setService.ts:269/283)
    reAddPrice = getCurrentMarketPrice(..., condition || null)
        → dort drinnen: effectiveCond = condition || userDefault
    recordAcquisition(..., reAddPrice, condition || 'N')
        → hier hart 'N'

Steht der Standard des Nutzers auf „Gebraucht", bekommt die Erfassung also
den GEBRAUCHT-Preis, wird aber als NEU verbucht. In der Finanzansicht steht
danach ein Neu-Eintrag mit einem Gebraucht-Preis — und die Erfassung zählt in
der falschen Gruppe.

Es ist dieselbe Verwechslung wie in Nachtrag 68, nur andersherum. Der
Kommentar dort sagt: „Ein als gebraucht erfasstes Set bekam dadurch den
Neupreis als Kaufpreis eingetragen — im gemeldeten Fall 55 statt 33 CHF."
Damals war der Preis falsch, jetzt der Vermerk.

── Warum gegen eine echte Datenbank ────────────────────────────────────────
Die Regel liest aus zwei Einstellungstabellen und schreibt in eine dritte.
Der interessante Fall ist ein Datenbankzustand: „Standard steht auf U".

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="module"></a>
## `const Module = require('node:module');`

```text
Der Nachzug nach dem Erfassen (jobs/nachErfassung.ts) wird abgefangen.

Er haengt an einem setTimeout von zwei bis fuenf Sekunden und laeuft damit
NACH diesem Test — gegen einen dann geschlossenen Verbindungspool:
  [weiter-trotz-fehler] instr-queue:trigger: Cannot use a pool after ...
Sichtbar war nur dieser eine Schritt, weil nur er protokolliert; die
uebrigen sechs schluckten ihren Fehler und liefen genauso ins Leere.
```

<a id="stelle"></a>
## `await haeltSet(db, uid, SET, 1, { zustand: 'N' });`

```text
── Den Aufstock-Weg ISOLIEREN ──────────────────────────────────────

Zwei addSet()-Aufrufe hintereinander messen ihn NICHT: Beide fallen auf
denselben Tag und denselben Zustand, die Tageszeile wird also
zusammengefasst. Die erste, korrekt geschriebene Zeile überdeckt dann
die zweite, und der Test ist grün, ohne den Pfad berührt zu haben.
(Genau das ist mir beim ersten Entwurf passiert.)

Deshalb eine Vorbedingung mit AUSDRÜCKLICH anderem Zustand: Der
nächste Aufruf nimmt damit den „existing"-Zweig von addSetIntern (die
sets-Zeile ist da) und schreibt seine eigene Tageszeile.

── Was sich am 21.10. geändert hat ─────────────────────────────────

Hier stand `haeltSet(db, uid, SET, 1)` ohne Zustand — der Helfer legt
dann eine Erfassung mit 'N' an, anders als der Kommentar daneben
behauptete („ohne Erfassung"). Der Test war trotzdem grün, aber aus
dem falschen Grund: recordAcquisitionForDay() fasste beide Zeilen zu
EINER zusammen, und „gebraucht gewinnt" machte daraus 'U'. Geprüft
war damit die Verschmelzung, nicht der Aufstock-Weg.

Seit Migration 0040 ist der Zustand Teil des Schlüssels: Zwei
Zustände sind zwei Zeilen (Marcos Befund, siehe
test/erfassung-je-zustand-db.test.js). Die Prüfung gilt deshalb jetzt
der Zeile, die der GEPRÜFTE Pfad geschrieben hat — nicht allen.
```
