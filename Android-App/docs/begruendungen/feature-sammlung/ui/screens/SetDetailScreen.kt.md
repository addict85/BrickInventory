# Begründungen zu `feature-sammlung/ui/screens/SetDetailScreen.kt`

Die ausführlichen Kommentare aus `feature-sammlung/src/main/java/ch/brickinventoryapp/ui/screens/SetDetailScreen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="detailretrystate"></a>
## `detailRetryState`

```text
Einmaliger, verzögerter Wiederholversuch — wie in der Galerie-Kachel: Direkt
nach dem Erfassen ist die Datei auf dem Server oft noch nicht fertig, und Coil
versucht von sich aus nie erneut; die Fläche bliebe leer bis zum nächsten
Öffnen.

An setNumber und imageUrl gebunden, damit die Zählung bei einem Wechsel neu
beginnt. memoryCacheKeyExtra macht die zweite Anfrage für Coil unterscheidbar,
sonst gälte sie als dieselbe gescheiterte. Als State-Objekt statt per `by`:
setDetailHeroImage() setzt den Wert im Fehlerzweig, dafür muss es dasselbe
Objekt sein, keine Kopie.
```
