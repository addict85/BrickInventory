# Begründungen zu `test/image-misses-reason-db.test.js`

Die ausführlichen Kommentare aus `test/image-misses-reason-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Was „fehlend" heisst — und wie man es zurücknimmt.

── Marcos Log (Nachtrag 123) ───────────────────────────────────────────────
    [image-queue] 2 bearbeitet: 0 geladen, 0 Vorschau erzeugt,
                  0 bereits vorhanden, 2 als fehlend bekannt

Der Zähler aus Nachtrag 122 nannte endlich den Ausgang. Offen blieb, wie die
beiden Bilder in `image_misses` gekommen waren — und das ist die Frage, die
zählt.

Der Job merkte sich JEDEN Fehlschlag ausser 403/429 als „dieses Bild gibt es
nicht": Zeitüberschreitung, DNS-Aussetzer, abgebrochene Verbindung, „Antwort
zu klein", zu viele Weiterleitungen, zu grosses Bild — und über den
umgebenden catch sogar einen Schreibfehler auf der eigenen Platte. Alles
davon sperrte das Bild sieben Tage aus.

Der Bild-Proxy macht es seit jeher richtig und begründet es im Code: dort
wird NUR bei 404 gemerkt. Zwei Bauteile, dieselbe Tabelle, zwei Auslegungen.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="sn-stelle"></a>
## `const sn = '${P}_leise';`

```text
── Marcos Protokoll ───────────────────────────────────────────────────

    [image-queue] 265-2: Vorschau fehlgeschlagen · 5010729-1: Download
                  fehlgeschlagen (HTTP 404)

Ein 404 heisst „dieses Set hat beim CDN kein Bild" — bei alten Sets der
Normalfall. Er wird vermerkt und NICHT wiederholt; es gibt nichts zu
tun. Als `error` gemeldet macht er das Protokoll unlesbar und damit die
echten Fehler daneben unsichtbar.

Geprueft wird die STUFE, nicht der Wortlaut: Was dort steht, ist
anderswo schon zugesichert (die Setnummer muss drinstehen) — hier geht
es darum, auf welchem Kanal es landet.
```
