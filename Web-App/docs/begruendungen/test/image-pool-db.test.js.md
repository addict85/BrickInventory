# Begründungen zu `test/image-pool-db.test.js`

Die ausführlichen Kommentare aus `test/image-pool-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Bildanfragen belegen KEINE Datenbankverbindung.

── Marcos Log ──────────────────────────────────────────────────────────────
    [route-error] 500: Error: timeout exceeded when trying to connect
        at pg-pool
        at getStats

Und gleichzeitig: `docker logs | grep -c img-proxy` → praktisch null.

Diese beiden Zeilen zusammen haben die Diagnose entschieden. Nicht die
Bildarbeit war die Last — es scheiterte eine ganz ANDERE Route daran, keine
Verbindung mehr zu bekommen. Das erklärt auch Marcos frühere Beobachtung
„als könnte der Server weniger Requests gleichzeitig bearbeiten": genau das
war es.

── Was ich falsch gemacht hatte ────────────────────────────────────────────
In Nachtrag 98 und 102 habe ich zwei Nachschläge aus dem Arbeitsspeicher in
die Datenbank verlegt — mit gutem Grund (im Cluster teilen sich die Prozesse
nichts). Dabei habe ich übersehen, WIE oft sie laufen: Bildanfragen sind der
häufigste Vorgang der ganzen Anwendung, eine Kachelwand sind dutzende
gleichzeitig. Bei 10–15 Verbindungen je Arbeitsprozess war der Pool damit
leer.

Ein richtiger Gedanke (gemeinsamer Zustand gehört in die Datenbank) am
falschen Ort (im heissesten Pfad).

── Die Regel, die dieser Test schützt ──────────────────────────────────────
Lesen aus dem Arbeitsspeicher, Schreiben gebündelt im Takt. Gemessen:

    60 Kacheln       vorher 120 Abfragen   →   jetzt 0
    Wegschreiben                            →   1 Abfrage
    40 Fehlanzeigen                         →   1 Abfrage

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="px-stelle"></a>
## `const px = require('./helpers/sources').proxyThumbQuelle();`

```text
── Marcos Log, immer wieder dieselbe Zeile ───────────────────────────────
    [thumb] Vorschau fehlgeschlagen für /images/sets/40393-1.jpg:
            Mime type image/webp does not support decoding

Jimp kann webp nicht entpacken. Scheitert der Versuch, entsteht keine
Datei — und beim nächsten Aufruf DESSELBEN Bildes wurde er wiederholt. Für
jedes webp-Bild also bei jedem Ansehen ein vergeblicher Anlauf, der das
Bild erst einliest und dann aufgibt. `_thumbInFlight` schützte nur für die
Dauer des Laufs.

Gemessen (Ablauf nachgestellt): fünf Seitenaufrufe ergaben vorher fünf
Versuche, jetzt einen.
```

<a id="px-stelle-2"></a>
## `const px = require('./helpers/sources').proxyThumbQuelle();`

```text
── Marcos Konsole (Nachtrag 109) ─────────────────────────────────────────
Dieselbe Adresse mehrfach hintereinander mit 404, etwa
`9780241838570-1.jpg` gleich zweimal.

Ein 404 OHNE Cache-Control ist für den Browser nicht zwischenspeicherbar:
Er fragt bei jedem Rendern der Kachel erneut. Beim Blättern durch alte
Jahrgänge, wo fast jedes Bild fehlt, ist das ein voller Satz Anfragen je
Bildschirm — bis zum Server, dort in den Merker und wieder zurück.
```

<a id="sendeplatzhalter"></a>
## `assert.match(px, /function sendePlatzhalter\(res(: \w+)?\)/,`

```text
── Der Weg heisst jetzt sendePlatzhalter (Nachtrag 165) ─────────────────

Typangabe zugelassen (Nachtrag 155), und seit Nachtrag 165 ein anderer
Name: Ein fehlendes Bild kommt als PLATZHALTER mit 200 zurück, damit die
Browser-Konsole beim Blättern durch alte Jahrgänge nicht voller roter 404
steht. Gemeint war hier nie die Schreibweise, sondern dass es EINEN
gemeinsamen Weg für „dieses Bild gibt es nicht" gibt und dass der Browser
sich die Antwort merken darf — beides gilt unverändert.
```

<a id="stelle"></a>
## `try { await db.initSchemaOnce(); }`

```text
── Marcos Log (Nachtrag 115) ─────────────────────────────────────────────
    timeout exceeded when trying to connect … at getSets

Nicht die Bildarbeit scheiterte, sondern eine gewöhnliche Anfrage bekam
keine Verbindung mehr.

Die Sperre lieh sich für die Dauer JEDER Verkleinerung eine Pool-Verbindung.
Der Pool ist auf 10–15 je Arbeitsprozess ausgelegt und dafür da, Anfragen zu
bedienen — und auf dem Primärprozess halten Preis-Job,
Anleitungs-Warteschlange und Teile-Anreicherung ohnehin schon je eine fest.

Dasselbe Muster wie in Nachtrag 103, nur dass ich es diesmal selbst
hineingebaut habe: beim Beheben von Nachtrag 100.
```

<a id="px-stelle-3"></a>
## `const px = require('./helpers/sources').proxyThumbQuelle();`

```text
Eine Sitzungssperre gehört der VERBINDUNG, die sie genommen hat. Wird sie
über eine andere freigegeben, tut das nichts — die Sperre bliebe für immer
bestehen, und es entstünde nie wieder ein Vorschaubild. Das ist mir in
Nachtrag 100 passiert.

Seit Nachtrag 115 ist es dieselbe EIGENE Verbindung (nicht aus dem Pool),
die zudem wiederverwendet wird.
```
