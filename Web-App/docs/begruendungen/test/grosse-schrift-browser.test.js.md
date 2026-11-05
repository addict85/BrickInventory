# Begründungen zu `test/grosse-schrift-browser.test.js`

Die ausführlichen Kommentare aus `test/grosse-schrift-browser.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Doppelte Schriftgrösse (Browser-Einstellung 32 px) und schmale Geräte:
Die Sammlung bleibt lesbar. Gemessen in Chrome mit Page.setFontSizes,
also so, wie ein Nutzer die Schrift im Browser vergrössert.

  - kein waagrechter Überlauf der Seite;
  - Set-Nummern stehen auf einer Zeile;
  - nichts in einer Kachel ragt über ihren Rand;
  - Kachelüberschriften der Kennzahlen brechen nicht im Wort;
  - die untere Leiste zeigt ganze Beschriftungen, nie „Sam…“ und nie nur Symbole;
  - ab etwa 360 px Breite zwei Spalten, darunter eine.
```
