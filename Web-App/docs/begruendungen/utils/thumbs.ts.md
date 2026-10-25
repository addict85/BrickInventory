# Begründungen zu `utils/thumbs.ts`

Die ausführlichen Kommentare aus `utils/thumbs.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Vorschaubilder: 200×200 JPEG, neben dem Original mit der Endung _thumb.jpg.

── Warum sharp und nicht mehr Jimp (Nachtrag 118) ──────────────────────────
Jimp ist reines JavaScript. Jede Verkleinerung läuft damit im selben Thread
wie alles andere — auf Marcos Raspberry Pi war das die teuerste Einzelarbeit
im ganzen Server. Fünf Nachträge lang habe ich sie gedrosselt, und am Ende
blieb: dreissig Läufe je Minute sind immer noch zu viel, weil jeder einzelne
teuer ist.

sharp setzt auf libvips auf. Es rechnet in nativem Code UND ausserhalb des
Event-Loops (libuv-Threadpool) — der Server bleibt währenddessen ansprechbar.
Das ist der eigentliche Gewinn: nicht nur schneller, sondern nicht mehr im
Weg.

Nebenbei fällt ein Dauerärgernis weg: Jimp kann webp nicht entpacken. Genau
daran scheiterten in Marcos Log immer dieselben Sets („Mime type image/webp
does not support decoding"). sharp kann es.

── Warum die Datei in utils/ liegt und nicht in routes/ ────────────────────
Sie lag in routes/, obwohl sie KEINE Route enthaelt — kein `router.get`,
kein `app.get`, nur drei Funktionen und einen Export. Der Ordnername sagte
damit etwas Falsches ueber ihren Inhalt.

Das blieb nicht folgenlos: generateThumb() wird an NEUN Stellen gebraucht,
verteilt auf jobs/catalogSync, jobs/imageQueue, jobs/partsCatalogEnrich,
jobs/startNachlaeufe, utils/partsImport, utils/setService und server.ts.
Alle sechs Nicht-Route-Dateien mussten also aus der aeussersten Schicht
importieren, um an eine Bildfunktion zu kommen. Die Abhaengigkeit zeigte
nach aussen statt nach innen, und zwar oefter als jede andere im Baum
(nachgemessen: der zweithaeufigste Fall hat zwei Nutzer).

Verschoben, nicht umgeschrieben: Der Inhalt ist derselbe.

── Jimp bleibt als Rückfall ────────────────────────────────────────────────
sharp bringt eine native Bibliothek mit. Lässt sie sich auf einer Plattform
nicht laden, wäre der Ausfall sonst total — keine Vorschau mehr, nirgends.
Deshalb der Rückfall auf den alten Weg. Er ist langsam, aber er funktioniert
seit Jahren.
```

<a id="generatethumb-tmpthumb"></a>
## `tmpThumb`

```text
ATOMAR schreiben (Nachtrag 41) — dieselbe Begründung wie in
routes/imgProxy.ts: Ein Schreibvorgang auf den ENDGÜLTIGEN Namen ist für
parallele Anfragen sichtbar, bevor er fertig ist. Die Bildroute liefert
dann eine Teilgrösse als Content-Length aus, der Browser zeigt nichts,
und weil das kaputte Bild mit ETag im Zwischenspeicher landet, bleibt es
dabei. rename() innerhalb desselben Dateisystems ist unteilbar.

Die Endung .jpg im temporären Namen stammt aus Nachtrag 48: Jimp leitete
das Zielformat aus ihr ab. sharp tut das nicht (das Format steht im
Aufruf), aber der Rückfall unten benutzt weiterhin Jimp — die Endung
bleibt deshalb.
```

<a id="generatethumb"></a>
## Abschnitt

```text
NICHT still scheitern (Nachtrag 49).

Hier stand `catch (e) { return null; }`. Genau das hat den .tmp-Fehler
aus Nachtrag 41 SIEBEN Nachträge lang verdeckt: Die Erzeugung scheiterte
bei jedem einzelnen Aufruf, und weder Log noch Zähler sagten ein Wort.
Gefunden wurde es erst, weil einem Nutzer auffiel, dass neue Sets keine
Vorschau bekommen — der teuerste denkbare Weg.

Aufräumen inbegriffen: Eine liegengebliebene .tmp.jpg würde sonst den
Ordner zumüllen, ohne je verwendet zu werden.
```
