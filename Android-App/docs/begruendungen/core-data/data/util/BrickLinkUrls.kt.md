# Begründungen zu `core-data/util/BrickLinkUrls.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/data/util/BrickLinkUrls.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="bricklinkurls"></a>
## `BrickLinkUrls`

```text
URL-Bau für externe BrickLink-Links — pure JVM-Logik (kein android.net.Uri),
damit sie in JUnit-Unit-Tests prüfbar ist.

WICHTIG: Für den Katalog wird die URL inzwischen serverseitig aufgelöst und
im Feld `bricklink.url` mitgeliefert (utils/bricklinkLink.ts). Der Grund:
Ob eine Rebrickable-Nummer auf BrickLink ein Set, Gear oder ein Buch ist,
steht nur in catalog_cache auf dem Server — der Client kann es nicht wissen.
setForSale() ist deshalb nur noch der Fallback für ältere Server, die das
Feld nicht liefern, und nimmt die häufigste Annahme (Set).
```
