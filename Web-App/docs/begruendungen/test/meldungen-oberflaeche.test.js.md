# Begründungen zu `test/meldungen-oberflaeche.test.js`

Die ausführlichen Kommentare aus `test/meldungen-oberflaeche.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Meldungen (Toasts): Fehler bleiben länger stehen, ein Klick räumt weg — am
echten Bündel in jsdom.

  - Eine Fehlermeldung steht nach allen Zeitgebern unter 8 s noch da und
    ist erst nach dem langen weg. Vorher verschwand jede Meldung ohne Knopf
    nach 4,5 s, auch ein Fehler, den man lesen will.
  - Ein Klick auf die Meldung entfernt sie sofort.
```
