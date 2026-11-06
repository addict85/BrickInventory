# Begründungen zu `test/bildschranke-leere-datei.test.js`

Die ausführlichen Kommentare aus `test/bildschranke-leere-datei.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine leere oder abgeschnittene Datei ist kein Bild.

── Marcos Protokoll ────────────────────────────────────────────────────────

    [thumb] Vorschau fehlgeschlagen für /images/sets/265-2.jpg:
            Input file contains unsupported image format

Die Schranke davor (src/katalog/bilder/imageGuard.ts, isDecodable) liest den Dateikopf
und entscheidet, ob die Datei an den Verkleinerer darf. Sie hatte einen
Rückfall:

    const dim = readDimensions(…);
    if (!dim) return true;      // unbekanntes Format: durchlassen

Der ist richtig gedacht — für ein Format, das wir nicht selbst lesen können,
soll der Dekodierer entscheiden. Er setzt aber voraus, dass es überhaupt
etwas zu entscheiden gibt. Bei NULL gelesenen Bytes erkennt readDimensions()
natürlich kein Format, und die leere Datei ging durch, bis sharp daran
scheiterte.

Dass daraus ein harter Fehler wurde und nicht ein stilles „keine Vorschau",
hat es überhaupt erst sichtbar gemacht. Der Fehler war also nicht das
Melden, sondern das Durchlassen.

── Warum 10 Byte ───────────────────────────────────────────────────────────

Das ist der kleinste denkbare Bildkopf im Baum: Ein GIF-Header ist 10 Byte
(GIF89a + Breite + Höhe), ein PNG braucht bis zum IHDR 24, ein JPEG bis zum
ersten SOF mehr. Unter 10 Byte kann keine der Formaterkennungen in
readDimensions() je etwas finden — die Datei ist nicht „unbekannt", sondern
leer.
```
