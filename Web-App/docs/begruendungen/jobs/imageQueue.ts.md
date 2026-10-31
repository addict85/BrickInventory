# Begründungen zu `jobs/imageQueue.ts`

Die ausführlichen Kommentare aus `jobs/imageQueue.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Bilder, die über den Proxy angefragt wurden, im HINTERGRUND lokal ablegen —
samt Vorschau.

── Marcos Vorgabe ──────────────────────────────────────────────────────────
„Ich fänd es sinnvoll, wenn die Bilder lokal gecached werden inkl. Thumbs.
Bitte aber die Bilder im Hintergrund mit dem Bilder-Download-Job
herunterladen und das Thumb erstellen, sobald sie einmal via Proxy geladen
wurden. Das sollte das gleiche Prinzip wie bei den anderen Reitern sein."

── Warum das der richtige Zuschnitt ist ────────────────────────────────────
Vorher hingen zwei Dinge an der ANFRAGE: Der Proxy holte das Bild und stiess
sofort die Verkleinerung an. Bei den eigenen Sets ist das unauffällig — ein
paar hundert Bilder, einmalig. Im Katalog mit 25 000 fremden Sets wurde
daraus eine Rechenlawine, die lange nach dem Scrollen weiterlief (Marcos
329 % CPU).

In Nachtrag 101 hatte ich die Verkleinerung im Katalog deshalb ganz
abgeschaltet. Das war zu grob: Wer ein Set zweimal ansieht, soll beim zweiten
Mal das kleine Bild bekommen.

Jetzt trennt sich beides sauber:
  • Die Anfrage liefert sofort aus — mit Vorschau, wenn es sie gibt, sonst
    mit dem Original. Sie rechnet NICHTS.
  • Sie hinterlässt eine Notiz: „dieses Bild wurde gebraucht".
  • Dieser Job arbeitet die Notizen ab, gedrosselt und nur auf dem
    Primärprozess.

Der Unterschied zur Warteschlange im Arbeitsspeicher (die es vorher gab): Die
Notizen stehen in der DATENBANK. Sie überleben den Neustart, und alle
Arbeitsprozesse schreiben in dieselbe — die Lehre aus den Nachträgen 98 bis
100, wo Grenzen je Prozess galten und deshalb nicht wirkten.
```

<a id="stapel"></a>
## `STAPEL`

```text
── Wie schnell geholt wird (Marcos Vorgaben, Nachtrag 113) ─────────────────

„Nur 30 Requests pro Minute" und „eine künstliche Verzögerung von mindestens
500 bis 1000 ms zwischen den einzelnen Bild-Requests".

Beides zusammen ergibt die Taktung: zehn Bilder je Durchgang, dazwischen
jeweils eine Pause, alle 20 Sekunden ein Durchgang. Macht dreissig Anfragen
je Minute, und keine zwei davon fallen zusammen.

Die Verzögerung ist ZUFÄLLIG zwischen 500 und 1000 ms. Ein exakt gleicher
Abstand ist selbst ein Muster — eine Heuristik, die nach Maschinen sucht,
erkennt Gleichmass leichter als Unregelmässigkeit.

Warum nicht nur bei grossen Mengen: Marco hatte die Vorgaben für Läufe über
200 Bildern gestellt. Die Unterscheidung einzubauen hiesse, zwei Verhalten zu
pflegen und zu prüfen — für den Gewinn, beim Blättern drei Bilder eine
Sekunde früher zu haben. Der Vorablauf ist ohnehin nichts, worauf jemand
wartet.
```

<a id="durchgang-max-notizen"></a>
## `DURCHGANG_MAX_NOTIZEN`

```text
── Wie viele Notizen ein Takt anfasst (Nachtrag 121) ───────────────────────

Marcos Log:

    [image-queue] 10 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 10 bereits vorhanden

— fünfmal hintereinander, bei 1113 Notizen in der Warteschlange.

Der Job arbeitete korrekt ab, nur unendlich langsam: STAPEL Notizen je
TAKT_MS, das sind dreissig je Minute, also gut 37 Minuten für Marcos
Warteschlange. In diesen fünf Durchgängen wurde dabei NICHTS geholt und
NICHTS gerechnet — für alle zehn lagen Bild und Vorschau längst da. Zwanzig
`existsSync`-Aufrufe, wenige Millisekunden, danach nahezu zwanzig Sekunden
Stillstand.

Die Ursache ist ein falscher Bezug: Die Dreissiger-Grenze ist Marcos Vorgabe
gegen eine Sperre durch das CDN („nur 30 Requests pro Minute"). Gezählt
wurden aber NOTIZEN. Eine übersprungene Notiz kostet das CDN nichts und darf
das Kontingent folglich auch nicht verbrauchen.

Innerhalb eines Stapels war das längst richtig — der Zähler `arbeit` sorgt
seit Nachtrag 116 dafür, dass Übersprünge keine Pause kosten. Nur auf den
NÄCHSTEN Stapel wirkte er nicht.

Jetzt gilt das Kontingent für die Arbeit: Ein Takt holt so lange Stapel nach,
bis STAPEL echte Arbeitsschritte getan sind (Download oder Verkleinerung),
die Warteschlange leer ist oder der Deckel unten greift. Die Rate am CDN
bleibt damit unverändert bei STAPEL je TAKT_MS.

Der Deckel begrenzt, was ein Takt an ÜBERSPRÜNGEN durchsieht. Er ist nötig,
weil `existsSync` synchron ist: Ohne ihn liefe eine Warteschlange aus 25 000
fertigen Bildern in einem Zug durch und hielte den Event-Loop des
Arbeitsprozesses in Schüben auf. Fünfhundert sind 1000 Dateizugriffe je
zwanzig Sekunden — genug, um Marcos 1113 in einer Minute abzuräumen, und
wenig genug, um zwischendurch Anfragen zu bedienen.
```

<a id="letztearbeit"></a>
## `_letzteArbeit`

```text
Zeitpunkt des letzten echten Arbeitsschritts — modulweit, nicht je Stapel.

Vorher hing die Pause an einem Zähler INNERHALB eines Stapels. Seit ein Takt
mehrere Stapel nachholt, wäre der erste Arbeitsschritt jedes Folgestapels
ohne Abstand gelaufen: zwei CDN-Anfragen unmittelbar hintereinander, genau
das Muster, das Marcos Vorgabe vermeiden soll. Der Abstand gehört deshalb
zwischen zwei ARBEITSSCHRITTE, gleich in welchem Stapel sie liegen.
```

<a id="initimagequeue"></a>
## Abschnitt

```text
── Wegschreiben läuft in JEDEM Arbeitsprozess ───────────────────────────

Marcos Befund: „Ich habe das Gefühl, die Bilder aus dem Katalog werden
nicht heruntergeladen im Hintergrund. Es sind immer gleich viele Bilder im
Ordner images/sets."

Er hat recht, und es ist derselbe Fehler wie in den Nachträgen 98 bis 100 —
diesmal in meinem eigenen Fix: Der Puffer liegt im ARBEITSSPEICHER eines
Prozesses, das Wegschreiben hing aber an start(), und start() läuft nur auf
dem Primärprozess. Bildanfragen verteilen sich über alle vier — drei
Viertel aller Notizen wurden also nie geschrieben, und was der Primär
notierte, nur wenn er die Anfrage zufällig selbst bediente.

initImageQueue() läuft dagegen in JEDEM Prozess (aus db/database.ts).
Deshalb steht der Takt hier und nicht in start().
```

<a id="vorschauerzeugen"></a>
## `vorschauErzeugen`

```text
Eine Vorschau erzeugen — und einen Fehlschlag MERKEN.

── Marcos Log (Nachtrag 117) ───────────────────────────────────────────────
    [thumb] Vorschau fehlgeschlagen für /images/sets/5007579-1.jpg:
            Mime type image/webp does not support decoding
— und dieselbe Zeile für 5007576-1, 5007623-1, immer wieder.

Jimp kann webp nicht entpacken. In Nachtrag 104 habe ich das gemerkt — aber
nur im Bild-Proxy. Der Job hier ruft `generateThumb()` DIREKT auf und
verschluckt den Fehler (`.catch(() => {})`). Also:

  • Es entsteht keine Datei.
  • Beim nächsten Durchgang gilt „Bild da, Vorschau fehlt" — und es wird
    erneut versucht.
  • Nach jedem Klick auf „Katalogbilder holen" wieder.

Für jedes webp-Bild also ein vergeblicher Jimp-Lauf, der die Datei erst
einliest und dann aufgibt. Auf einem Raspberry Pi ist das genau die Arbeit,
die niemand haben will.

Wieder derselbe Befund wie so oft in dieser Reihe: Der Schutz existierte,
sein Geltungsbereich war zu eng — er stand im Proxy, nicht im Job.
```

<a id="stapelergebnis"></a>
## `StapelErgebnis`

```text
Was ein Durchgang getan hat.

── Warum nicht nur eine Zahl (Nachtrag 120) ────────────────────────────────
Marcos Befund: „Der Bild-CDN-Job scheint zu laufen laut Monitoring und
Fortschrittsbalken, aber im Log sind keine Einträge dazu zu finden."

Er hatte recht, und das Schweigen war eingebaut: Der Takt meldete nur, wenn
`fertig > 0`. Ein Durchgang, der zehn Notizen abarbeitet und alle
überspringt — weil Bild und Vorschau längst liegen —, sagte nichts. Von
aussen sah das aus wie ein hängender Job, obwohl die Warteschlange schrumpfte.

Schlimmer war die Kachel: Sie meldete „läuft", sobald die Warteschlange nicht
leer war (Nachtrag 108). Das ist keine Aussage über TÄTIGKEIT — eine
steckengebliebene Warteschlange sah genauso aus wie eine, die abgearbeitet
wird. Die Anzeige konnte den Unterschied gar nicht kennen.
```

<a id="stapelergebnis-2"></a>
## Abschnitt

```text
── Die stillen Ausgänge (Nachtrag 122) ───────────────────────────────────

Marcos Log:
    [image-queue] 2 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 0 bereits vorhanden
— zweimal, und seine Frage: „Wieso werden die 2 Bilder nicht geladen?"

Die Zahlen gingen nicht auf, und das war kein Zufall: VIER Wege durch die
Schleife endeten, ohne irgendeinen der drei Zähler zu erhöhen — Notiz ohne
Setnummer, gescheiterte Verkleinerung, gescheiterter Download, und der
Abbruch nach einer Drosselung. Die Meldung konnte die vier nicht
unterscheiden und meldete für alle dasselbe Nichts.

Das ist derselbe Fehler wie in Nachtrag 120, eine Ebene tiefer: Dort
schwieg der Job, wenn nichts GETAN wurde; hier schweigt er, wenn etwas
SCHIEFGING. Ein Zähler je Ausgang, und die Frage beantwortet sich selbst.
```

<a id="letzterlauf"></a>
## `letzterLauf`

```text
Stand des letzten Durchgangs — für die Überwachungskachel.

── Warum das nicht im Arbeitsspeicher bleiben durfte (Nachtrag 121) ────────
Marcos Kachel meldete „Job noch nicht gelaufen", während im Log gerade fünf
Durchgänge standen.

Dieser Merker lag ausschliesslich hier im Modul. Gesetzt wird er dort, wo der
Job läuft — im Primär-Worker. Gelesen wurde er in routes/api_v1/admin.ts von
dem Worker, der die Monitoring-Anfrage zufällig bediente. Bei vier Workern
sah die Kachel also in drei von vier Fällen `null` und schloss daraus auf
„noch nicht gelaufen".

Das ist zum siebten Mal dasselbe Muster dieser Reihe: prozesslokaler Zustand
im Cluster. Bitter ist, dass es für genau diesen Zweck src/auftraege/jobMonitor.ts
gibt („stores status in PostgreSQL so all cluster workers share state") — die
vorgesehene Ablage wurde hier umgangen.

Der Merker bleibt im Modul, weil der Takt ihn im Sekundenbereich braucht;
maßgeblich für die Kachel ist aber die Zeile in `global_settings`.
```

<a id="loescheverfallene"></a>
## `loescheVerfallene`

```text
Verfallene Notizen löschen.

── Was der Kommentar behauptete und der Code nicht tat (Nachtrag 121) ──────
Bei NOTIZ_GILT_MS stand „Ältere Notizen als diese verfallen". Sie verfielen
nicht: Die Abfrage des Stapels grenzt nur ein, was sie AUSWÄHLT — gelöscht
wurde nie etwas anderes. Notizen älter als drei Tage blieben also für immer
liegen, zählten weiter in der Kachel (COUNT(*) ohne Frist) und liessen den
Job verstummen, weil die Logzeile an `gesamt > 0` hängt. Von aussen sah das
aus wie eine Warteschlange, die bei einer Zahl stehenbleibt.
```

<a id="arbeitestapel-arbeit"></a>
## `arbeit`

```text
Zählt ARBEIT, nicht nur Downloads.

── Marcos Log (Nachtrag 116) ────────────────────────────────────────────
Zeile um Zeile „[image-queue] N Bilder lokal abgelegt", dazwischen
`Connection terminated due to connection timeout` — bis hin zum
Sitzungsspeicher, der keine Verbindung mehr bekam.

Die Pause aus Nachtrag 113 hing an `geholt`, und das zählte nur echte
Downloads. Lag ein Bild bereits lokal, fehlte ihm aber die Vorschau, lief
der Zweig darüber: Vorschau rechnen, `continue` — OHNE Pause. Nach dem
Knopf „Katalogbilder holen" ist das der Normalfall, denn 16 000 Bilder
lagen schon.

Ergebnis: zehn Jimp-Läufe je Durchgang, ohne Atempause, auf einem
Raspberry Pi. Die CPU war belegt, und alles andere — Datenbankabfragen
eingeschlossen — kam nicht mehr durch.

Eine Verkleinerung ist die TEUERSTE Einzelarbeit im Server. Dass die Pause
nur den billigeren Teil betraf, war der Fehler.
```

<a id="arbeitestapel-datei"></a>
## `datei`

```text
── Liegt das Bild schon? Dann nur die Vorschau nachholen ───────────────

Der Knopf „Alle Katalogbilder holen" reiht ALLE Sets ein, ohne je Datei
zu prüfen — 25 000 Dateizugriffe in einer Anfrage wären auf schwacher
Hardware eine spürbare Blockade. Die Prüfung gehört hierher, wo ohnehin
gedrosselt gearbeitet wird.

Der zweite Teil ist Marcos ausdrückliche Frage: „Bitte auch prüfen, dass
für Katalogbilder jeweils ein Thumbs-Image erstellt wird." Für Bilder,
die vor dem Hintergrund-Job abgelegt wurden, fehlt die Vorschau
womöglich — hier wird sie nachgezogen.
```

<a id="arbeitestapel"></a>
## Abschnitt

```text
── Bekannt fehlende Bilder gar nicht erst holen (Nachtrag 122) ────────

merkeFehlend('set:…') wurde weiter unten GESCHRIEBEN, aber nirgends im
Job gelesen — der Knopf „Katalogbilder holen" achtet darauf (per SQL),
der Job nicht. Eine Notiz, die über den Proxy erneut entsteht, löste
deshalb bei jedem Durchgang wieder einen Roundtrip zu einem Bild aus,
von dem längst feststand, dass es der CDN nicht hat — und verbrauchte
dafür einen Platz im Kontingent.

Die Prüfung steht VOR der Pause: Ein Bild, das der CDN nicht hat, kostet
ihn nichts und darf deshalb weder das Kontingent noch Wartezeit belegen.
```

<a id="arbeitestapel-2"></a>
## Abschnitt

```text
── Drosselung ist KEINE Fehlanzeige ─────────────────────────────────

Marcos Frage: „Können so viele Requests abgefragt werden, oder wird da
Cloudflare die IP sperren?"

Beim Nachsehen fiel auf: Bisher galt jeder Fehlschlag als „dieses Bild
gibt es nicht" — auch ein 403 oder 429. Gerade bei einer Drosselung
sind die Bilder aber VORHANDEN, und der Ansturm, der sie auslöst,
hätte hunderte davon für sieben Tage ausgesperrt.

Deshalb: Nur ein 404 wird gemerkt. Bei 403/429 legt der Job eine Pause
ein und gibt die restlichen Notizen zurück in die Warteschlange — sie
sind ja schon gelöscht, also neu einreihen.
```

<a id="arbeitestapel-hartfehlend"></a>
## `hartFehlend`

```text
── NUR ein 404 heisst „das Bild gibt es nicht" (Nachtrag 123) ───────

Marcos Log: „2 als fehlend bekannt" — die beiden Bilder standen in
image_misses und wurden deshalb gar nicht mehr versucht. Wie kamen sie
dorthin?

Bis hierher merkte sich der Job JEDEN Fehlschlag ausser 403/429: eine
Zeitüberschreitung, einen DNS-Aussetzer, eine abgebrochene Verbindung,
„Antwort zu klein", „zu viele Weiterleitungen", ein zu grosses Bild —
und über den umgebenden catch sogar einen Schreibfehler auf der
eigenen Platte. Alles davon sperrte das Bild SIEBEN TAGE aus, und von
aussen war nicht zu erkennen, dass es je einen Versuch gab.

Der Bild-Proxy macht es längst richtig und begründet es sogar im Code:
dort wird nur bei 404 gemerkt. Zwei Bauteile, dieselbe Tabelle, zwei
verschiedene Auslegungen von „fehlend" — wieder „Regel fehlt am
zweiten Weg", diesmal als Widerspruch statt als Lücke.

Ein vorübergehender Fehler führt jetzt zu KEINEM Vermerk. Die Notiz ist
ohnehin verbraucht; entsteht sie über den Proxy neu, wird es erneut
versucht — das ist genau das gewünschte Verhalten für „geht gerade
nicht".
```

<a id="arbeitestapel-3"></a>
## Abschnitt

```text
── Die Betroffenen beim Namen nennen ────────────────────────────────────

Eine Zahl sagt „zwei sind gescheitert", nicht WELCHE. Genau das fehlte
Marco, um weiterzukommen: Mit der Setnummer beantwortet
GET /api/v1/admin/image-diag/:setNumber die Frage in EINER Antwort.
Nur bei wenigen Fällen — bei fünfzig wäre die Zeile unlesbar, und die
Einzelgründe stehen ohnehin in den [set-img]- und [thumb]-Zeilen.

── error nur, wenn etwas ZU TUN ist ─────────────────────────────────────

Marcos Protokoll nach einem Serverstart:

    [image-queue] 265-2: Vorschau fehlgeschlagen · 5010729-1: Download
                  fehlgeschlagen (HTTP 404)

Ein 404 heisst „dieses Set hat beim CDN kein Bild" — bei alten Sets der
Normalfall. Er wird als Fehlanzeige vermerkt und NICHT wiederholt; es
gibt nichts zu tun. Besteht der ganze Stapel aus solchen Faellen, ist
`warn` die ehrliche Stufe. Sobald EIN Grund etwas anderes ist (eine
gescheiterte Vorschau, ein 403, ein Netzwerkfehler, der wiederholt wird),
bleibt es `error` — und faellt dann auch wieder auf.
```

<a id="taktdurchgang"></a>
## `taktDurchgang`

```text
Ein Takt: Stapel nachholen, bis das Kontingent für echte Arbeit aufgebraucht
ist, die Warteschlange leer ist oder der Deckel greift.

Der Abbruch hängt an `arbeit`, nicht an `gesamt` — siehe die Begründung bei
DURCHGANG_MAX_NOTIZEN. Für Marcos Fall („10 bereits vorhanden", fünfmal
hintereinander) heisst das: Statt fünf Takte über hundert Sekunden räumt ein
einziger Takt bis zu fünfhundert fertige Notizen ab.
```
