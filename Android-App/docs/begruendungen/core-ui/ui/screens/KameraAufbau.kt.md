# Begründungen zu `core-ui/ui/screens/KameraAufbau.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/screens/KameraAufbau.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="bildanalyse"></a>
## `bildAnalyse`

```text
Eine Bildanalyse mit den Einstellungen, die für beide Scanner gelten.

Der AF-Modus steht auch hier, nicht nur am Preview: CameraX führt alle
gebundenen Use Cases zu einem Repeating-Request zusammen, und je nach Gerät
entscheidet die Analyse-Konfiguration mit — deren Vorgabe ist nicht zwingend
CONTINUOUS_PICTURE. Derselbe Modus an beiden macht das Ergebnis unabhängig
davon, welcher führt.

Die Auflösung ist der einzige gewollte Unterschied: Der Setup liest einen
QR-Code mit grossen Modulen, der Barcodescanner kleine EAN-Striche und
Setnummern. Mehr Auflösung kostet je Bild Rechenzeit, die sich Kamera und
Vorschau teilen.

@param breite Bildbreite in Pixeln, z. B. 1920
@param hoehe  Bildhöhe in Pixeln, z. B. 1080
```

<a id="kamerabinden"></a>
## `kameraBinden`

```text
Vorschau und Bildanalyse an den Lebenszyklus binden — für beide Scanner. Zwei
Regeln stecken darin:

1. Das `try` umschliesst den gesamten Rückruf. `future.get()` kann werfen, seit
CameraX 1.4.0 prüft, ob die Kamera verfügbar ist (etwa weil eine andere App sie
belegt). Ohne die Absicherung stürzt die App ab, statt nur kein Bild zu zeigen.

2. `unbindAll()` vor dem Binden. Sonst bleibt eine frühere Bindung an derselben
Kamera hängen.

@param analyse die Bildanalyse aus [bildAnalyse]
@param beiFehler wird gerufen, wenn die Kamera nicht verfügbar ist. Der Scanner
        meldet das; der SetupScreen lässt die Vorschau bewusst leer — deshalb
        ein Rückruf und keine feste Behandlung hier.
@param beiKamera bekommt die gebundene Kamera. Hier hängen die Aufrufer an, was
        nur sie betrifft.
```
