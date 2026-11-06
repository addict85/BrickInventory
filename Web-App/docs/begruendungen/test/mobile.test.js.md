# Begründungen zu `test/mobile.test.js`

Die ausführlichen Kommentare aus `test/mobile.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Frontend-Tests für public/js/10-mobile.js in jsdom.

Unter 640px verwandelt mobile.css jede .dt-Tabelle in eine Kartenliste. Damit
dann noch erkennbar ist, welcher Wert wozu gehört, braucht jede <td> die
Beschriftung ihrer Spalte in data-label — das CSS blendet sie über ::before
ein.

Diese Attribute setzt ein MutationObserver nachträglich, statt alle zehn
Tabellen-Templates in sechs Dateien anzufassen. Der Nutzen steht und fällt
damit, dass die Zuordnung stimmt: mehrzeilige Köpfe (Finanztabellen) und
colspan (Gruppenzeilen) kommen in dieser Codebasis beide vor.

Ausführen: npm test
```
