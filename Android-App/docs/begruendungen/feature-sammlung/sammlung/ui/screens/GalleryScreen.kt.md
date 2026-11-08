# Begründungen zu `feature-sammlung/ui/screens/GalleryScreen.kt`

Die ausführlichen Kommentare aus `feature-sammlung/src/main/java/ch/brickinventoryapp/sammlung/ui/screens/GalleryScreen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="retrynonce-by-remember"></a>
## `retryNonce by remember`

```text
Einmaliger, verzögerter Wiederholversuch nach einem Ladefehler: Direkt nach dem
Erfassen ist das Bild auf dem Server oft noch nicht fertig, und Coil wiederholt
eine gescheiterte Anfrage nie von selbst. An Setnummer und Adresse gebunden,
damit eine wiederverwendete Kachel neu zählt; memoryCacheKeyExtra("retry", …)
macht die zweite Anfrage für Coil 3 zu einer anderen. Genau ein Versuch, damit
ein fehlendes Bild nicht in eine Schleife läuft.
```
