# Begründungen zu `public/js/01-diagramme.js`

Die ausführlichen Kommentare aus `public/js/01-diagramme.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="rendermarketrows"></a>
## `renderMarketRows`

```text
Marktpreis und Entwicklung je Zustand in den Detail-Dialog schreiben.

Eine Zeile erscheint nur für Zustände, zu denen eine Erfassung existiert —
der Server entscheidet das (by_condition, siehe src/finanzen/priceHistory.ts) und
liefert gar keinen Eintrag für die anderen. Damit taucht eine neue Zeile
automatisch auf, sobald ein Kaufpreis in diesem Zustand erfasst wird: Nach
jedem Speichern wird diese Abfrage erneut geladen.
```
