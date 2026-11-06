# Begründungen zu `test/farbwerte-escapen.test.js`

Die ausführlichen Kommentare aus `test/farbwerte-escapen.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein Farbwert aus der Datenbank geht durch escHex(), bevor er in ein
style-Attribut kommt.

── Der Befund ──────────────────────────────────────────────────────────────
00-escapen.js hat escHex() genau dafür, und der Kommentar dort sagt es
ausdrücklich: „Farbwert in style="" → escHex()". Benutzt hat es aber nur
03-parts.js — das Modul, in dem die Funktion ursprünglich stand. Drei andere
schrieben den Wert roh hinein:

    style="background:#${p.color_hex}"        06-minifigs.js
    background:#${grp.color_hex};             08-init.js
    background:#${item.color_hex};            13-acquisition-modals.js

Wieder dieselbe Form: eine Regel, eine Fassung, und drei Stellen, die sie
nie bekommen haben.

── Warum das nicht bloss Ordnung ist ───────────────────────────────────────
Die Werte kommen aus rb_colors.rgb, also aus dem Rebrickable-Katalog. Ein
unerwarteter Inhalt bricht im besten Fall das Layout — und ein Wert mit
einem Anführungszeichen bricht aus dem style-Attribut heraus. escHex()
prüft auf genau sechs Hexziffern und liefert sonst den Rückfall.

── Warum die Regel eng gefasst ist ─────────────────────────────────────────
Eine Prüfung „jede Interpolation muss escaped sein" hätte 917 Fundstellen
und hunderte Fehlalarme — Übersetzungen, Zahlen, eigene Konstanten. Ein
Test, der korrekten Code anmeckert, wird abgeschaltet statt befolgt. Diese
Regel fragt nur nach FARBWERTEN, und dort ist die Antwort eindeutig.
```
