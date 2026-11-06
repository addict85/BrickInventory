# Begründungen zu `test/meldungen-oberflaeche.test.js`

Die ausführlichen Kommentare aus `test/meldungen-oberflaeche.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Meldungen (Toasts), am echten Bündel in jsdom:

  - Ein Fehler und eine Meldung mit Knopf („Rückgängig“) laufen nicht ab
    (Barrierefreiheit 17, M4: WCAG 2.2.1); sie schliessen über ihr ✕.
  - Eine Meldung ohne Knopf hält ihre Frist an, solange Maus oder Fokus
    darauf liegt.
  - Ein Klick auf die Meldung entfernt sie sofort.
```
