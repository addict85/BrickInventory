# Begründungen zu `feature-sammlung/ui/screens/BarcodeAnalyzer.kt`

Die ausführlichen Kommentare aus `feature-sammlung/src/main/java/ch/brickinventoryapp/ui/screens/BarcodeAnalyzer.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="z16"></a>
## z16

```text
Der Bildanalyse-Teil des Barcode-Scanners: Barcode-Leser, Texterkennung,
Bestätigungszählung und Drosselung. Getrennt von der Einbettung der
Kamera-Vorschau, weil wer an der Erkennung arbeitet, mit PreviewView,
Lebenszyklus und Fokus-Gesten nichts zu tun hat. Zählerstände, Drosselung, die
ML-Kit-Clients und ihr Aufräumen liegen hier, weil nur diese Schleife sie
benutzt.
```

<a id="jetzt"></a>
## `jetzt`

```text
Kein Barcode im Bild → Texterkennung. Die Reihenfolge ist
Absicht: Der Barcode ist eindeutig, die gelesene Zahl nur
wahrscheinlich — auf der Verpackung gewinnt der Barcode, die
Texterkennung greift auf der Anleitung.

Gedrosselt, weil sie bei 1920×1080 je Bild ein Vielfaches der
Barcode-Suche kostet und die Kamera sich die Rechenzeit teilt —
Vorschau und Scharfstellen würden zäh. Eine gedruckte Setnummer
läuft nicht weg.
```
