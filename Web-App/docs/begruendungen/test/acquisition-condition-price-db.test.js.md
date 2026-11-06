# Begründungen zu `test/acquisition-condition-price-db.test.js`

Die ausführlichen Kommentare aus `test/acquisition-condition-price-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="fs-stelle"></a>
## `const fs = require('node:fs');`

```text
── Zweimal dieselbe Lücke (Nachträge 146 und 147) ────────────────────────

146 hat das BEARBEITEN behoben (resolvePrice in den Erfassungsrouten).
Marcos nächster Befund zeigte, dass das ERFASSEN denselben Fehler hatte:
Zwei heute angelegte Einträge derselben Figur, „Neu" und „Gebraucht",
beide Kaufpreis CHF 2.18 — obwohl die Marktpreise 2.18 und 2.20 sind.

Beim Anlegen der zweiten Zeile gab es erst die erste; der ohne Zustand
geholte Preis leitete sich also aus ihr ab.

Ich hatte beim ersten Mal nur die Stellen angesehen, die im Fehlerbericht
vorkamen. Diese Prüfung sieht ALLE — auch die, die noch niemand gemeldet
hat.
```
