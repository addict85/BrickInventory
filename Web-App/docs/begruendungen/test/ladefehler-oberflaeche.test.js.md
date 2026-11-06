# Begründungen zu `test/ladefehler-oberflaeche.test.js`

Die ausführlichen Kommentare aus `test/ladefehler-oberflaeche.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ladefehler und fehlende Verbindung — am echten Bündel in jsdom.

  - Antwortet der Server beim ersten Laden einer Liste mit einem Fehler,
    steht der Grund mit „Erneut versuchen“ da, nicht „Noch keine Sets“.
    Der Knopf lädt neu. Dasselbe gilt für Merkliste, Teile, Minifiguren,
    Katalog und Finanzen (ein Baustein: fehlerZustand).
  - Scheitert ein späteres Neuladen, bleibt die alte Liste stehen; eine
    Meldung sagt, dass es der letzte Stand ist.
  - Ein Netzfehler beim Erfassen meldet „Keine Verbindung zum Server“ statt
    des Browsertexts „Failed to fetch“.
  - Ohne Verbindung steht ein Band „Keine Verbindung seit …“; mit
    Verbindung verschwindet es.
```
