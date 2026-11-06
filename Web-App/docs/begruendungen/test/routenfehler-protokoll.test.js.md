# Begründungen zu `test/routenfehler-protokoll.test.js`

Die ausführlichen Kommentare aus `test/routenfehler-protokoll.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="test"></a>
## `const test = require('node:test');`

```text
Die Fehlerzeile nennt, WELCHE Anfrage gescheitert ist.

── Marcos Befund ───────────────────────────────────────────────────────────
Im Serverprotokoll stand:

    [route-error] 404: Error: Nicht gefunden
        at fehlerWerfen (…/fehlerTexte.js:243:13)
        at …/routes/api_v1/acquisitions.js:93:55

Der Stack sagt, WELCHE ZEILE geworfen hat. Er sagt nicht, welche Anfrage
dort ankam — und genau das entschied hier alles: acquisitions.js bedient
Teile und Minifiguren aus EINER gemeinsamen Fabrik, und die gesuchte
Kennung steht im Pfad. Ohne sie liess sich „die Zeile war schon geloescht"
nicht von „die Oberflaeche schickt die falsche Nummer" trennen.

── Was hier geprueft wird ──────────────────────────────────────────────────
Die Funktion wird AUSGEFUEHRT, nicht gelesen: console.error wird
abgefangen, handleRouteError mit einer nachgebauten Anfrage gerufen und die
Zeile untersucht. Ein Quelltexttest haette hier wenig Wert — die Frage ist
nicht, ob die Zeichenkette zusammengebaut wird, sondern was am Ende
dasteht.

Vier Zusicherungen:
  1. Methode und Pfad stehen drin.
  2. Der Fragezeichen-Teil NICHT — ein Protokoll ist der falsche Ort, um im
     Einzelfall zu entscheiden, was in einer Abfrage stehen darf.
  3. Ohne `req` bleibt die Zeile wie bisher. Sonst waere aus einer
     Ergaenzung ein „undefined undefined" in jeder Zeile geworden, die
     keine Anfrage kennt.
  4. Ein 4xx ist eine Warnung ohne Stack, ein 5xx ein Fehler mit Stack —
     sonst füllt jede falsche Eingabe app_logs mit Fehlern.
```
