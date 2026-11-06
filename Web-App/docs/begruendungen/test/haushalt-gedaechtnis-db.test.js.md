# Begründungen zu `test/haushalt-gedaechtnis-db.test.js`

Die ausführlichen Kommentare aus `test/haushalt-gedaechtnis-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Das Blickfeld wird gemerkt — und bei jeder Änderung sofort vergessen.

── Was gemessen wurde ──────────────────────────────────────────────────────
resolveHousehold() steht am Anfang praktisch jedes Lese-Endpunkts und machte
dort zwei Abfragen. Über die echten Routen gezählt (vorher → nachher):

    /api/v1/sets          5 → 5 Abfragen   (die erste füllt das Gedächtnis)
    /api/v1/parts         6 → 4
    /api/v1/minifigs      5 → 3
    /api/v1/stats         9 → 7
    /api/v1/parts/stats   5 → 3

Und die Funktion selbst: 0,438 ms → 0,001 ms je Aufruf (500 Aufrufe).

── Warum dieser Test mehr prüft als die Ersparnis ──────────────────────────
Ein Gedächtnis ist erst dann richtig, wenn es zur richtigen Zeit LEER ist.
Drei Wege können still falsch werden, und jeder hat hier eine Zusicherung:

 1. Es wird gar nicht gemerkt → die Ersparnis fällt weg (Zusicherung 1).
 2. Es wird nach einer Änderung nicht geleert → ein gelöstes Unterkonto
    bliebe bis zu fünf Minuten im Blickfeld (Zusicherung 2).
 3. Das Signal an die anderen Cluster-Worker geht nicht raus → dort gilt 2.
    genauso, nur unsichtbar für jeden Test, der nur einen Worker kennt
    (Zusicherung 3).

Dazu die vierte: Die zurückgegebene Mitgliederliste muss eine FRISCHE Liste
sein. scopeIds() gibt sie teilweise unverändert weiter; fasste ein Aufrufer
sie an, veränderte er sonst den gemerkten Stand für alle folgenden Anfragen
— ein Fehler, den man an der Fundstelle nie sähe.

Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
```
