# Begründungen zu `test/preisverlauf-zustand.test.js`

Die ausführlichen Kommentare aus `test/preisverlauf-zustand.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="test"></a>
## `const test = require('node:test');`

```text
Der Preisverlauf zeichnet nur Zustände, zu denen es eine Erfassung gibt.

Marco: „Das gezeigte Teil hat nur einen Kaufpreis mit dem Zustand gebraucht.
Trotzdem wird im Preisverlauf auch eine Linie mit 'neu' angezeigt." Für Sets
galt die Regel schon, für manuelle Teile und Figuren nicht. Geprüft wird am
Verlauf einer Figur mit Preisen in beiden Zuständen und nur einer
Gebraucht-Erfassung.
```
