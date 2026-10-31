# Begründungen zu `src/katalog/bilder/imageGuard.ts`

Die ausführlichen Kommentare aus `src/katalog/bilder/imageGuard.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Schutzgrenzen für die Bildverarbeitung mit Jimp.

── Das Problem ─────────────────────────────────────────────────────────────
Jimp ist reines JavaScript und dekodiert im Haupt-Thread. Der Speicherbedarf
hängt nicht von der DATEIGRÖSSE ab, sondern von der Pixelzahl: Ein Bitmap
belegt Breite × Höhe × 4 Bytes. Eine PNG-Datei mit 20'000 × 20'000 Pixeln ist
als Datei nur wenige Kilobyte gross (eine einfarbige Fläche komprimiert
hervorragend), belegt beim Dekodieren aber rund 1,6 GB und blockiert dabei
den Event-Loop des Workers für Sekunden. Man nennt das eine Dekompressions-
bombe; die 5-MB-Grenze des Bild-Proxys greift dagegen nicht, weil sie die
komprimierte Grösse misst.

── Die Lösung ──────────────────────────────────────────────────────────────
Vor dem Dekodieren nur den Dateikopf lesen und die Abmessungen bestimmen.
Bild-Header sind klein und stehen am Anfang der Datei — 64 KB reichen für
PNG, JPEG und GIF sicher aus. Erst wenn Breite × Höhe unter der Grenze
liegt, wird Jimp überhaupt aufgerufen.

Die Grenze von 40 Megapixeln ist grosszügig: Set-Bilder der CDNs liegen bei
unter 1 MP, eine 50-Megapixel-Kamera erzeugt 50 MP. Es geht nicht darum,
grosse Fotos abzulehnen, sondern absurde Werte abzufangen.
```

<a id="readdimensions"></a>
## `readDimensions`

```text
Abmessungen aus einem Bild-Header lesen — ohne die Bilddaten zu dekodieren.

Unterstützt PNG, JPEG und GIF; das sind die Formate, die über den Bild-Proxy
und die Anleitungs-Uploads hereinkommen. Bei einem unbekannten Format wird
null geliefert, und der Aufrufer entscheidet (siehe assertDecodable: im
Zweifel durchlassen, damit ein exotisches, aber harmloses Format nicht
grundlos scheitert).

@param {Buffer} buf Die ersten Bytes der Datei
@returns {{width: number, height: number} | null}
```

<a id="isdecodable"></a>
## Abschnitt

```text
── Eine LEERE oder abgeschnittene Datei ist kein Bild ─────────────────

Marcos Protokoll:

    [thumb] Vorschau fehlgeschlagen fuer /images/sets/265-2.jpg:
            Input file contains unsupported image format

Ohne diese Schranke kam so eine Datei durch: `bytesRead` ist 0, damit
erkennt readDimensions() kein Format, und der Rueckfall „unbekanntes
Format: durchlassen" liess sie weiter — bis sharp daran scheiterte.

Der Rueckfall ist richtig gedacht: Fuer ein Format, das wir nicht lesen
koennen, soll der Dekodierer entscheiden. Er setzt aber voraus, dass es
ueberhaupt etwas zu entscheiden GIBT. Null gelesene Bytes heissen
„leer", und abgeschnitten kleiner als der kleinste denkbare Bildkopf
(ein GIF hat 10 Byte, ein PNG-IHDR 24) heisst „kaputt". Beides ist kein
unbekanntes Format, sondern gar keines.

Dass daraus ein harter Fehler wurde und nicht ein stilles „keine
Vorschau", hat es ueberhaupt erst sichtbar gemacht — der Fehler war
also nicht das Melden, sondern das Durchlassen.
```
