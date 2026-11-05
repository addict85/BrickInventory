# Begründungen zu `test/zustand-fuer-preis-db.test.js`

Die ausführlichen Kommentare aus `test/zustand-fuer-preis-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Zustands-Staffelung Eingabe → Bestand → Standard, ausgeführt.

── Woher die Regel kommt ───────────────────────────────────────────────────
Nachträge 146 und 147. Der Kern steht als Kommentar in routes/parts.ts:
„Zustand der neuen Erfassung folgt dem Teil selbst (bzw. dem User-Default),
nicht hartkodiert 'N' — sonst bekäme ein als \"Gebraucht\" geführtes Teil bei
jeder Mengen-Erhöhung eine \"Neu\"-Erfassung."

Die Staffelung stand VIERMAL im Baum, in zwei Fassungen: beim Bearbeiten mit
Eingabe, beim Erfassen ohne. Das ist nicht zweierlei Regel, sondern derselbe
Fall mit und ohne ersten Schritt. Dass es zwei getrennte Wege sind, hat schon
einmal Arbeit gekostet: 146 hat das Bearbeiten behoben, 147 musste das
Erfassen nachziehen.

── Warum gegen eine echte Datenbank ────────────────────────────────────────
Der letzte Schritt liest aus zwei Tabellen (user_settings, global_settings)
mit einer eigenen Vorrangregel. Ein Test mit erfundenen Werten prüfte davon
nichts. Und der interessanteste Fall ist gerade ein DB-Zustand: Die leere
Zeichenkette, die das Formular schreibt, darf den globalen Standard NICHT
verdrängen.
```
