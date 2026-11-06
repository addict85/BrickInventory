# Begründungen zu `test/image-misses-db.test.js`

Die ausführlichen Kommentare aus `test/image-misses-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Fehlende Bilder werden EINMAL geholt — nicht je Prozess und Besuch neu.

── Marcos Befund ───────────────────────────────────────────────────────────
„Beim ersten Scrollen im Katalog funktioniert es einwandfrei, wenn ich dann
weiter scrolle zu 1958, ist es wieder das gleiche Problem." Dazu der Log:
seitenweise `[set-img] HTTP 404 vom Bildserver` für Sets aus den Fünfzigern
und Sechzigern — und `docker stats` mit 142 % CPU im Container.

Für alte Sets hat Rebrickable meist gar kein Bild. Jede Kachel dort löste
einen Roundtrip zum CDN aus, der ins Leere ging.

── Warum die vorhandenen Merker nicht reichten ─────────────────────────────
Es GAB zwei: Der Bild-Proxy hielt 404er fünfzehn Minuten fest, der Katalog
merkte sich versuchte Sets. Beide lagen im Arbeitsspeicher EINES Prozesses —
und der Server läuft im Cluster mit mehreren Arbeitsprozessen (im Log:
16, 22, 23, 24). Dasselbe fehlende Bild wurde deshalb einmal je Prozess
geholt, nach einem Neustart erneut, und nach fünfzehn Minuten wieder.

Das ist die Klasse Fehler, die in dieser Reihe schon mehrfach vorkam: Ein
Schutz existiert, aber sein Geltungsbereich ist enger als das Problem.

── Gemessen ────────────────────────────────────────────────────────────────
Ein Jahrgang mit 60 bildlosen Sets:

    1. Besuch                    60 Versuche
    2. Besuch                     0 weitere
    frischer Prozess              weiss Bescheid

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="im-stelle"></a>
## `const IM = _req('src/katalog/bilder/imageMisses.js');`

```text
Der Kern der Sache: Der Server läuft im Cluster. Ein Merker im
Arbeitsspeicher hilft nur DEM Prozess, der ihn angelegt hat — bei vier
Arbeitsprozessen wird dasselbe Bild viermal geholt.

Seit Nachtrag 103 ist das Lesen rein im Arbeitsspeicher (eine Abfrage
je Bild leerte den Verbindungspool). Das Wissen wandert im Takt in die
Tabelle und von dort in die anderen Prozesse; hier wird beides von Hand
angestossen, um den frischen Prozess nachzustellen.
```
