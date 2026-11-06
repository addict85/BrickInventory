# Begründungen zu `test/thumb-atomic.test.js`

Die ausführlichen Kommentare aus `test/thumb-atomic.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Vorschaubilder entstehen ATOMAR — halbe Dateien gehen nie an den Client.

── Woher dieser Test kommt (Marcos Beobachtung, Nachtrag 41) ───────────────
Bild in der Galerie-Kachel dauerhaft leer, in der Detailansicht dagegen
einwandfrei. Das war der entscheidende Hinweis: Die Kachel fragt dieselbe
Datei MIT `thumb=1` an, die Detailansicht OHNE. Der Fehler musste also im
Vorschau-Zweig liegen.

Die Erzeugung schrieb direkt auf den ENDGÜLTIGEN Dateinamen. Eine Anfrage,
die in genau diesem Moment hereinkommt, sieht die Datei bereits (access()
gelingt), liest per stat() eine TEILgrösse und setzt sie als
Content-Length — der Browser bekommt ein abgeschnittenes JPEG und zeigt
nichts. Hinterher liegt die Datei heil auf der Platte, der Fehler ist also
unsichtbar; im Browser bleibt er stehen, weil das kaputte Bild samt ETag im
Zwischenspeicher landet.

Empirisch nachgestellt: Die parallele Anfrage sah 4'000 von 12'000 Bytes.
Mit rename() sieht sie entweder nichts (und fällt sauber auf das Original
zurück) oder die fertige Datei — dazwischen gibt es nichts.

Der Bild-Cache daneben machte es seit jeher richtig (tmpFile → rename); nur
bei den Vorschauen fehlte es, in BEIDEN Erzeugern.
```
