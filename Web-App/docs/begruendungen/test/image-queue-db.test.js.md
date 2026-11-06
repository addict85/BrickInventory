# Begründungen zu `test/image-queue-db.test.js`

Die ausführlichen Kommentare aus `test/image-queue-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Bilder werden im HINTERGRUND lokal abgelegt — die Anfrage rechnet nichts.

── Marcos Vorgabe ──────────────────────────────────────────────────────────
„Ich fänd es sinnvoll, wenn die Bilder lokal gecached werden inkl. Thumbs.
Bitte aber die Bilder im Hintergrund mit dem Bilder-Download-Job
herunterladen und das Thumb erstellen, sobald sie einmal via Proxy geladen
wurden. Das sollte das gleiche Prinzip wie bei den anderen Reitern sein."

── Was vorher an der Anfrage hing ──────────────────────────────────────────
Der Proxy holte das Bild UND stiess sofort die Verkleinerung an. Bei den
eigenen Sets fiel das nicht auf — ein paar hundert Bilder, einmalig. Im
Katalog mit 25 000 fremden Sets wurde daraus eine Rechenlawine, die lange
nach dem Scrollen weiterlief (Marcos Messung: 329 % CPU).

In Nachtrag 101 hatte ich die Verkleinerung im Katalog ganz abgeschaltet.
Das war zu grob: Wer ein Set zweimal ansieht, soll beim zweiten Mal das
kleine Bild bekommen.

── Die Aufteilung, die hier geprüft wird ───────────────────────────────────
  • Die Anfrage liefert sofort aus und hinterlässt nur eine NOTIZ.
  • Der Job arbeitet die Notizen gestapelt ab: Original ablegen, verkleinern,
    Notiz entfernen.

Die Notizen stehen in der DATENBANK, nicht im Arbeitsspeicher. Sie überleben
den Neustart, und alle Arbeitsprozesse schreiben in dieselbe — die Lehre aus
den Nachträgen 98 bis 100, wo Grenzen je Prozess galten und deshalb nicht
wirkten.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="stapel"></a>
## `const stapel = IQ.STAPEL;`

```text
Der Sinn der Sache: Auf schwacher Hardware darf nicht der ganze
Rückstau in einem Rutsch gerechnet werden.
Die Stapelgrösse steht in der Quelle (Nachtrag 108: von 5 auf 20
erhöht, nachdem die CPU-Ursachen behoben waren). Der Test liest sie
dort, statt eine Zahl zu wiederholen, die sich ändern darf — die REGEL
ist „nicht alles auf einmal", nicht „genau fünf".
```

<a id="stelle"></a>
## `try { await db.initSchemaOnce(); }`

```text
── Marcos Wunsch (Nachtrag 108) ──────────────────────────────────────────
„Ich fände es sprechend, wenn diese in der Kachel ‚Bild-Download (CDN)'
enthalten sind, da der Titel nichts von meinen Sets aussagt."

Er hat recht: Die Kachel zählte ausschliesslich Bilder des eigenen
BESTANDES und meldete „Alle 62 170 Bilder gecacht", während der
Hintergrund-Job gerade hunderte Katalogbilder nachlud. Der Titel verspricht
aber alles, was vom CDN kommt.
```

<a id="stelle-2"></a>
## `await db.run('DELETE FROM laufzustand WHERE schluessel='imgqueue_last_`

```text
── „running" heisst jetzt: hat kürzlich etwas getan (Nachtrag 120) ────

Vorher genügte eine nicht leere Warteschlange. Das war keine Aussage über
TÄTIGKEIT — eine steckengebliebene Warteschlange sah genauso aus wie eine,
die abgearbeitet wird. Genau daran ist Marco hängengeblieben: Kachel und
Fortschrittsbalken meldeten Betrieb, im Log stand nichts.

Ohne einen Durchgang steht sie deshalb auf „idle" UND nennt den Grund.

Zurücksetzen: Ein früherer Teilschritt dieser Datei hat den Job schon
laufen lassen. Der Stand liegt seit Migration 0063 in `laufzustand`
und nicht mehr nur im Modulspeicher — dort muss er also weg. (Vorher
genügte hier `letzterLauf.zeit = null`; genau das hat mitverdeckt, dass
die Kachel eine PROZESSLOKALE Zahl las. Den Nachweis, dass ein anderer
Prozess den Stand sieht, führt image-queue-pace-db.test.js.)
── Die Kachel hat DREI Eingaenge, dieser Test beherrschte einen ──────

In routes/api_v1/admin.ts steht

    status: (imgRunning || reDlRunning || (katalogOffen > 0 && jobLaeuft))

Zurueckgesetzt wurde hier nur das dritte Glied. Die anderen beiden
liegen ebenfalls in der DATENBANK und ueberdauern damit die Grenze
zwischen zwei Testdateien — jede laeuft zwar im eigenen Prozess, aber
alle auf derselben Datenbank.

Aufgefallen im ALLERERSTEN CI-Lauf dieses Repositories: dort rot, hier
gruen. Nachgestellt und bewiesen — ein hinterlassenes
imgredl_status={running:true} macht genau diese Zeile rot
(„'running' !== 'idle'"), und ohne den Schluessel ist sie wieder gruen.

Der eigentliche Fehler lag daneben und ist behoben: Der Leser beachtete
das Alter des Standes nicht, und der Schreiber wartete sein eigenes
Schreiben nicht ab. Diese Zeilen hier stellen sicher, dass der Test
MISST, was er behauptet, statt auf einen aufgeraeumten Nachbarn zu
hoffen.
```

<a id="stelle-3"></a>
## `await db.run('DELETE FROM laufzustand WHERE schluessel='imgqueue_last_`

```text
── Ein STEHENGEBLIEBENES „läuft" ist kein Betrieb ────────────────────

Der Bilder-Nachlauf (redownloadMissingImages) legt seinen Fortschritt in
`imgredl_status` ab und setzt ihn am Ende auf `running: false`. Wird der
Prozess mittendrin beendet — Neustart, Auslieferung, Container gestoppt
—, kommt er dazu nie mehr. Hier stand `reDl?.running === true`, also der
Wert ohne sein Alter: Die Kachel meldete dann für immer Betrieb.

Genau dieselbe Regel steht zwölf Zeilen daneben für den Katalog-Job,
begründet mit Marcos Befund „scheint zu laufen, aber im Log steht
nichts". Sie stand nur an einer der beiden Stellen.

Gemessen wird der UNTERSCHIED: zwei Stände, die sich ausschliesslich im
Zeitstempel unterscheiden, müssen verschieden ausfallen. Ein Test, der
nur den alten Stand prüft, bliebe auch dann grün, wenn die Kachel gar
keinen Betrieb mehr melden könnte.
Die anderen beiden Eingaenge zuerst stilllegen — sonst misst dieser
Abschnitt sie statt des Nachlaufs. (Erster Anlauf tat genau das: Der
Durchgang von eben liess `jobLaeuft` wahr sein, und die Kachel stand
auch mit zehn Minuten altem Nachlauf auf „running". Dieselbe
Fehlerklasse wie der Fehler, um den es hier geht.)
```

<a id="stelle-4"></a>
## `const { meldung } = _req('jobs/imageQueue.js');`

```text
── Marcos Befund (Nachtrag 120) ──────────────────────────────────────────
„Der Bild-CDN-Job scheint zu laufen laut Monitoring und Fortschrittsbalken,
aber im Log sind keine Einträge dazu zu finden."

Das Schweigen war eingebaut: Der Takt meldete nur, wenn etwas GELADEN
wurde. Ein Durchgang, der zehn Notizen abarbeitet und alle überspringt —
weil Bild und Vorschau längst liegen —, sagte nichts. Von aussen sah das
aus wie ein hängender Job, obwohl die Warteschlange schrumpfte.

Ausgerechnet wenn er am schnellsten arbeitet, schwieg er am lautesten.

UMFORMULIERT in Nachtrag 122: Die Prüfung hing am WORTLAUT der Takt-Funktion
(`if (e.gesamt)` und der Name `uebersprungen` im Meldungstext). Als die
Meldung in die Funktion meldung() wanderte, wurde sie rot, ohne dass sich
ihre Aussage geändert hätte — dieselbe Sorte Test, die in Nachtrag 118 eine
Sicherheitslücke festgeschrieben hat. Geprüft wird jetzt, was der Text SAGT.
```

<a id="mig-stelle"></a>
## `const mig = fs.readFileSync(`

```text
── Marcos Befund (Nachtrag 107) ──────────────────────────────────────────
    relation "image_wanted" does not exist
auf einem Server, der die aktuelle App-Version fährt.

Ich hatte die Tabellen am Ende von initSchema() angelegt. Die läuft aber
nur, wenn sich die APP-Version geändert hat (schema_meta), und der Aufruf
stand hinter einem `.catch(...)`, das Fehler nur protokolliert. Schlug er
beim ersten Start einer Version fehl, wurde die Version trotzdem als
„angewandt" vermerkt — und danach nie wieder versucht. Ein einziger
stiller Fehlschlag schaltete den Bild-Job dauerhaft ab.

Nummerierte Migrationen laufen IMMER und werden EINZELN vermerkt. Genau
dafür gibt es sie; ich hatte den vorgesehenen Weg nicht benutzt.
```

<a id="q-stelle"></a>
## `const q = fs.readFileSync(path.join(ROOT, 'src/katalog/bilder/bildbeda`

```text
── Marcos Befund (Nachtrag 106) ──────────────────────────────────────────
„Ich habe das Gefühl, die Bilder aus dem Katalog werden nicht
heruntergeladen im Hintergrund. Es sind immer gleich viele Bilder im Ordner
images/sets."

Er hatte recht. Der Puffer liegt im ARBEITSSPEICHER eines Prozesses, das
Wegschreiben hing aber an start() — und start() läuft nur auf dem
Primärprozess. Bildanfragen verteilen sich über alle vier: Drei Viertel
aller Notizen wurden nie geschrieben, und was der Primär notierte, nur
wenn er die Anfrage zufällig selbst bediente.

Derselbe Geltungsbereichs-Fehler wie in den Nachträgen 98 bis 100 und 105,
diesmal in meinem eigenen Fix: Etwas Prozess-Lokales an etwas
Prozess-Globales gehängt.

initImageQueue() läuft in JEDEM Prozess (aufgerufen aus db/database.ts) —
dort gehört der Takt hin.
```

<a id="stelle-5"></a>
## `assert.match(dbInit, /\binitImageQueue\(\)/,`

```text
UMFORMULIERT in Nachtrag 155 — aus demselben Grund wie zwoelf Zeilen
tiefer bei start(), nur hatte diese Nachbarzusicherung den Fehler behalten:
Sie verlangte die Schreibweise `jobs/imageQueue').initImageQueue()`, also
ausdruecklich ein require(). Als daraus ein Top-Level-Import wurde, wurde
sie rot — obwohl der Aufruf an derselben Stelle steht und dieselbe Wirkung
hat. Gemeint ist: initImageQueue() wird beim Aufbau der Datenbank
aufgerufen. Das prueft jetzt der Aufruf selbst, gleich welcher Herkunft.
```
