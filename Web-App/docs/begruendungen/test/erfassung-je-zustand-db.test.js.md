# Begründungen zu `test/erfassung-je-zustand-db.test.js`

Die ausführlichen Kommentare aus `test/erfassung-je-zustand-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Zwei Zustände am selben Tag sind ZWEI Erfassungen, mit eigenen Preisen.

── Marcos Befund vom 21.10. ────────────────────────────────────────────────

  „Beim Import der Liste dann darauf achten, dass wenn das Teil und Farbe
   bereits existiert und nur der Zustand anders ist, einen neuen Preis
   erzeugen mit einem anderen Zustand."

GEMESSEN vorher, eine Wanted-Liste mit zweimal 3001 in Rot — 3 Stück NEU zu
1.50 und 2 Stück GEBRAUCHT zu 0.50:

  part_acquisitions: 1 Zeile — quantity 5, unit_price 1.10, condition 'U'

1.10 ist der mengengewichtete Mischpreis, und der Zustand wurde 'U', weil im
Projekt „gebraucht gewinnt". Die drei neuen Teile zu 1.50 standen damit als
gebraucht zu 1.10 in der Finanzansicht.

── Warum dieser Test NEBEN manual-acq-refresh.test.js steht ────────────────

Dort wird der QUELLTEXT geprüft: dass der Zustand in der Bedingung steht und
„gebraucht gewinnt" beim Aufstocken weg ist. Das ist ein Netz gegen das
Zurückrutschen, aber es sagt nichts darüber, was am Ende in der Datenbank
liegt — und genau das ist Marcos Befund. Hier laufen deshalb echte
Erfassungen gegen eine echte Datenbank, mitsamt dem Unique-Index aus
Migration 0040. Eine Hälfte allein wäre schon einmal grün gewesen, während
die andere falsch war.
```
