# Begründungen zu `feature-finanzen/ui/screens/FinanceSections.kt`

Die ausführlichen Kommentare aus `feature-finanzen/src/main/java/ch/brickinventoryapp/finanzen/ui/screens/FinanceSections.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="items"></a>
## `items`

```text
── Eine vollständige Karte je Kaufpreis ──

Ein Set mit einem Kaufpreis für „Neu“ und einem für „Gebraucht“ erscheint
zweimal, jede Karte mit dem Marktpreis ihres Zustands — sonst würde das neu
gekaufte Exemplar mit dem Gebrauchtpreis bewertet. Gleichrangige Karten statt
Unterzeilen, weil jede für einen eigenen Kauf steht; Unterzeilen läsen sich wie
die Aufschlüsselung einer Summe. Zusammengehalten durch Bild und Setnummer,
unterschieden durch die Zustands-Plakette.
```
