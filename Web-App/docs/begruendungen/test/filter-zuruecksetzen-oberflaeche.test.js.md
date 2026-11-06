# Begründungen zu `test/filter-zuruecksetzen-oberflaeche.test.js`

Die ausführlichen Kommentare aus `test/filter-zuruecksetzen-oberflaeche.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
„Filter zurücksetzen“ im Leerzustand ohne Treffer — am echten Bündel in
jsdom.

  - Sammlung: Eine Suche ohne Treffer zeigt den Knopf; ein Klick leert das
    Suchfeld und lädt ohne `search` neu.
  - Ein Themenfilter ohne Suchtext ist auch ein Filter: Es steht „Keine Sets
    passen zu diesem Filter“ mit Knopf, nicht „Noch keine Sets“.
  - Merkliste: dasselbe für die Suche.
```
