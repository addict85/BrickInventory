# Begründungen zu `test/tastatur-karten.test.js`

Die ausführlichen Kommentare aus `test/tastatur-karten.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Karten und Zeilen mit data-click lassen sich mit der Tastatur auslösen —
am echten Bündel in jsdom (public/js/11-actions.js).

  Eingabe auf einer Karte mit tabindex       → Klick
  Leertaste auf role="button"               → Klick
  Leertaste auf einer Tabellenzeile          → nichts (sie rollt die Seite)
  Eingabe auf einem echten Knopf darin       → kein zweiter Klick der Karte
```
