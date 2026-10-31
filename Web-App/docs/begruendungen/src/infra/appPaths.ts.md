# Begründungen zu `src/infra/appPaths.ts`

Die ausführlichen Kommentare aus `src/infra/appPaths.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Zentrale Auflösung der Anwendungspfade.

── Warum das nötig wurde ───────────────────────────────────────────────────
Die Codebasis berechnete Pfade zu data/ und public/ überall aus __dirname:
in server.ts als `path.join(__dirname, 'data')`, in den Modulen unter
routes/ und utils/ als `path.join(__dirname, '..', 'data')`. Das funktionierte,
solange die transpilierten .js NEBEN ihren Quellen lagen — server.js in der
Wurzel, routes/*.js eine Ebene darunter.

Seit der Build nach dist/ schreibt, stimmt das nicht mehr: dist/server.js
sieht als __dirname das Verzeichnis dist/, nicht die Wurzel. Jeder dieser
Pfade hätte auf dist/data bzw. dist/public gezeigt — also NEBEN das
gemountete Volume. Der Effekt wäre besonders unangenehm gewesen, weil nichts
abstürzt: Verzeichnisse werden bei Bedarf angelegt, Uploads landen dort
brav — und sind nach dem nächsten Container-Neustart weg.

Deshalb wird die Wurzel EINMAL bestimmt und überall von hier bezogen.

── Wie die Wurzel gefunden wird ────────────────────────────────────────────
Ausgangspunkt ist das Verzeichnis dieser Datei. Von dort aus wird nach oben
gegangen, bis eine package.json auftaucht — das ist die Wurzel, unabhängig
davon, ob der Code aus den Quellen (utils/) oder aus dem Build (dist/utils/)
läuft. APP_ROOT lässt sich zusätzlich per Umgebungsvariable überschreiben.
```

<a id="images-dir"></a>
## `IMAGES_DIR`

```text
Heruntergeladene Set-, Teile- und Minifiguren-Bilder.

── Warum das aus public/ herausgezogen wurde ───────────────────────────────
Set-Bilder landeten bisher unter public/images/sets/ — also im Verzeichnis
der ausgelieferten Repo-Assets, das im Docker-Image aus dem Build-Stage
kommt und NICHT im gemounteten Volume liegt. Drei Folgen:

  1. Nach jedem Container-Rebuild waren alle Bilder weg und mussten einzeln
     neu vom CDN geholt werden — bei ein paar tausend Sets stundenlang, mit
     entsprechendem Verbrauch am API-Tageskontingent.
  2. Eine Sicherung von data/ erfasste sie nicht. Wer data/ zurückspielte,
     hatte die Datenbank, aber keine Bilder.
  3. public/ war nicht mehr "nur Code": Laufzeitdaten und Build-Ergebnis
     lagen im selben Baum — dieselbe Vermischung wie vorher bei .ts/.js.

Jetzt liegen sie unter data/images/ und damit im Volume. Der WEB-PFAD bleibt
absichtlich unverändert bei "/images/…": In der Datenbank stehen tausende
image_local-Werte mit diesem Präfix, und die Android-App baut ihre Bild-URLs
daraus. Eine Änderung des Pfads hätte eine Datenmigration UND ein
gleichzeitiges App-Update erzwungen — ohne jeden Gegenwert, denn welches
Verzeichnis dahinter liegt, geht den Client nichts an.
```

<a id="set-images-dir"></a>
## `SET_IMAGES_DIR`

```text
Bilder nach Art getrennt.

── Wie es vorher aussah ────────────────────────────────────────────────────
Set-Bilder lagen unter data/images/sets/, Teile- UND Minifiguren-Bilder
dagegen zusammen in data/part_images/. Der Name war damit doppelt irreführend:
Er stand auf derselben Ebene wie data/images (statt darin), und er nannte nur
eine der beiden Sorten, die er enthielt — die Figuren-Bilder landeten dort
über denselben downloadImage()-Aufruf.

Jetzt eine Ebene, drei sprechende Ordner:

  data/images/sets/       75192-1.jpg
  data/images/parts/      3001_4.png
  data/images/minifigs/   fig-001234_0.jpg

Vorschaubilder liegen wie bisher als <name>_thumb.jpg DANEBEN, nicht in einem
eigenen Unterordner — die Zuordnung ergibt sich aus dem Dateinamen.
```

<a id="instructions-dir"></a>
## `INSTRUCTIONS_DIR`

```text
Geteilte Bauanleitungen (PDFs).

── Warum der Unterordner "shared" entfallen ist ────────────────────────────
Die Dateien lagen unter data/instructions/shared/. Der Unterordner sollte sie
von benutzereigenen Anleitungen abgrenzen — die liegen aber gar nicht hier,
sondern unter data/uploads/<benutzer-id>/. data/instructions/ enthielt also
ausschliesslich "shared" und bestand aus genau einem Unterordner.

Dass die Trennung trotzdem nötig schien, lag an der Auslieferung: Die
generische /data/instructions/-Route prüft das erste Pfadsegment gegen die
Benutzer-ID. Diese Route gibt es für Anleitungen nicht mehr — sie sind
benutzerübergreifend und werden als solche ausgeliefert (siehe server.ts).
```
