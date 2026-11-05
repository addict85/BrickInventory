# Begründungen zu `scripts/generate-design-tokens.js`

Die ausführlichen Kommentare aus `scripts/generate-design-tokens.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Erzeugt aus shared/design-tokens.json die Design-Dateien BEIDER Oberflaechen.

── Warum ───────────────────────────────────────────────────────────────────
Das Web liest CSS-Custom-Properties, die App braucht Compose-Farben.
Derselbe Wert, zwei Sprachen — bisher stand er zweimal da und wurde von Hand
gleichgehalten. Jetzt steht er einmal, und beide Seiten werden daraus
erzeugt.

Aufruf: node scripts/generate-design-tokens.js
        (laeuft auch als Teil von `npm run build`)

Geprueft wird das Ergebnis von test/design-abschrift.test.js: Weicht eine
erzeugte Datei von der Quelle ab, wird der Lauf rot. Deshalb macht es nichts,
dass die Erzeugnisse mit im Baum liegen — sie muessen es sogar, weil der
Android-Build kein Node kennt.
```

<a id="aufgeloest"></a>
## `function aufgeloest(daten, name, roh) {`

```text
Die Tokens eines Designs — mit `erbt` aufgeloest.

── Warum es das gibt ───────────────────────────────────────────────────────

"hochglanz" ist "noppe" als lackierte Broschuere: dieselben Farben, dazu
Schichten (Woelbung, Lichtkuppen, Lichtstreifen), die gar kein Farbwert
sind. Die elf Werte ein zweites Mal hinzuschreiben waere eine Abschrift,
und eine Abschrift zieht beim naechsten Mal nicht mit.

Genau EINE Stufe: `erbt` auf ein Design, das selbst erbt, waere eine Kette,
und bei einer Kette muss man beim Lesen rueckwaerts suchen, wo ein Wert
herkommt. Das meldet diese Funktion lieber, als es zuzulassen.
```
