# Begründungen zu `test/manuelle-listen-filter-db.test.js`

Die ausführlichen Kommentare aus `test/manuelle-listen-filter-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Filter der Reiter „Teile" und „Minifiguren" trifft BEIDE Listen.

── Marcos Befund vom 20.10. ────────────────────────────────────────────────

  „Wenn ich im Filter z.b. nach 3001 suche passiert nichts."

NACHGEMESSEN am laufenden Server (angemeldet, Reiter Teile, zwei manuell
erfasste Kacheln): Vor der Eingabe standen „9999 | Brick 2 x 2" und
„3001 | Brick 2 x 4 | Red" da, nach der Eingabe von „3001" DIESELBEN ZWEI.
Getroffen hatte der Suchtext allein die Wand der Set-Teile darunter (dort
null Treffer, weil das Teil manuell erfasst ist).

── Warum das nicht Auslegung ist ───────────────────────────────────────────

public/index.html stellt die Filterleiste ÜBER den manuellen Bereich und
begründet es dort ausdrücklich:

    „Die manuell erfassten Teile stehen UNTER der Filterleiste (Nachtrag 34,
     Marcos Hinweis): Der Filter wirkt auf beide Listen — auf die manuellen
     und die aus Sets."

test/tab-layout.test.js prüft diese Anordnung, für BEIDE Reiter. Geprüft war
damit die Anordnung, nicht ihre Wirkung: Die Leiste versprach etwas, das die
Abfrage nicht hielt — und zwar in beiden Reitern. Marco hat es an den Teilen
gesehen; die Minifiguren trugen es unbemerkt mit.

── Gefiltert wird am SERVER ────────────────────────────────────────────────

Wie beim Konto- und Lagerortfilter daneben (public/js/14-scope.js schreibt
den Grund aus). Deshalb steht die Prüfung hier an den Abfragen und nicht an
einem Cache im Browser.
```
