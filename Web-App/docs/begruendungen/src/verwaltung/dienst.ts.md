# Begründungen zu `src/verwaltung/dienst.ts`

Die ausführlichen Kommentare aus `src/verwaltung/dienst.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="job-frisch-ms"></a>
## `JOB_FRISCH_MS`

```text
Wie lange ein gemeldeter Betrieb ohne neues Lebenszeichen gilt.

Steht an EINER Stelle, weil zwei Kacheln dieselbe Frage beantworten: Ist das
„laeuft" von eben noch aktuell? Vorher stand die Zahl nur beim Katalog-Job;
der Bilder-Nachlauf daneben hatte gar keine Frist und blieb nach einem
abgebrochenen Lauf fuer immer auf „laeuft".

Drei Minuten: lang genug, dass ein langsamer Durchgang nicht faelschlich als
tot gilt (der Takt schreibt alle zwanzig Sekunden), kurz genug, dass ein
abgestuerzter Lauf nicht den ganzen Tag Betrieb vortaeuscht.
```

<a id="get-admin-jobs-katalogoffen"></a>
## `katalogOffen`

```text
── Katalog-Bilder gehören in DIESE Kachel ────────────────────────────────

Marcos Wunsch: „Ich fände es sprechend, wenn diese in der Kachel
‚Bild-Download (CDN)' enthalten sind, da der Titel nichts von meinen Sets
aussagt."

Er hat recht: Die Kachel zählte ausschliesslich Bilder des eigenen
BESTANDES und meldete „Alle 62 170 Bilder gecacht", während der
Hintergrund-Job gerade hunderte Katalogbilder nachlud. Der Titel verspricht
aber alles, was vom CDN kommt.

`image_wanted` ist die Warteschlange des Jobs (jobs/imageQueue.ts): Jede
Bildanfrage über den Proxy hinterlässt dort eine Notiz.
```

<a id="get-admin-jobs-letzterlauf"></a>
## `letzterLauf`

```text
── „läuft" heisst: hat kürzlich etwas getan ─────────────────────────────

Marcos Befund: „Der Job scheint zu laufen laut Monitoring und
Fortschrittsbalken, aber im Log sind keine Einträge dazu zu finden."

Die Kachel meldete „läuft", sobald die Warteschlange nicht leer war
(Nachtrag 108). Das ist keine Aussage über TÄTIGKEIT: Eine
steckengebliebene Warteschlange sah genauso aus wie eine, die abgearbeitet
wird. Jetzt zählt der Zeitpunkt des letzten Durchgangs — bleibt er aus,
steht die Kachel auf „idle" und nennt den Grund.

── Der Stand kommt aus der DATENBANK (Nachtrag 121) ─────────────────────

Marcos Kachel meldete „Job noch nicht gelaufen", während im Log gerade
fünf Durchgänge standen. Hier stand vorher

    const { letzterLauf } = require('../../jobs/imageQueue');

— also ein Blick in den ARBEITSSPEICHER des Prozesses, der diese Anfrage
gerade bedient. Gesetzt wird der Merker aber nur dort, wo der Job läuft
(Primär-Worker). Bei vier Workern war die Antwort in drei von vier Fällen
`null`. Der Job schrieb in `global_settings`, sobald er etwas getan hat;
von dort sehen ihn alle Worker.
```

<a id="post-admin-catalog-images-fs"></a>
## `fs`

```text
── Was schon fertig ist, wird nicht wieder eingereiht ────────────────

Marcos Befund: „Wenn ich auf den Button klicke, werden immer ca. 29 000
Bilder eingereiht. Auch wenn der Job bereits einmal erfolgreich
durchgelaufen ist."

Er hatte recht, und die Begründung, die ich in Nachtrag 111 dafür notiert
habe, war zu kurz gedacht: Ich wollte 25 000 einzelne Dateizugriffe in
einer Anfrage vermeiden — richtig — und habe daraus geschlossen, gar
nicht zu prüfen. Dabei geht es EINMAL: Ein Verzeichnis lesen liefert alle
Namen in einem Zug.

Ohne die Prüfung reihte jeder Klick den ganzen Katalog ein. Der Job
arbeitete das zwar richtig ab (Datei da → überspringen), aber die Kachel
zeigte 29 000 offene Bilder, und jede Notiz kostete einen Durchgang.
```
