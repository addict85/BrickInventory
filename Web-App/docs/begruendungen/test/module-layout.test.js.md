# Begründungen zu `test/module-layout.test.js`

Die ausführlichen Kommentare aus `test/module-layout.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Wo Module liegen — und dass ein API-Name kein Pfad ist.

── Warum es diese Datei gibt (Nachtrag 126) ────────────────────────────────

Beim Umzug von rebrickable.ts und brickset.ts aus routes/ nach clients/ habe
ich die Verweise per Textersetzung umgebogen. Der Ausdruck traf auch das hier:

    checkAndIncrementRateLimit('rebrickable')   →  ('../clients/rebrickable')
    getRateLimitStatus('brickset')              →  ('../../clients/brickset')

Das sind KEINE Modulpfade, sondern die Schlüssel der Tageskontingente. Unter
einem neuen Schlüssel hätte jede API bei null angefangen zu zählen — die
Zählung wäre gespalten worden, und zwar lautlos: kein Absturz, keine
Fehlermeldung, nur ein Kontingent, das plötzlich nie mehr erreicht wird.

Neun Stellen in vier Dateien waren betroffen. Gefunden hat es ein Test, der
zufällig einen dieser Aufrufe im Wortlaut prüfte; beim Zurückdrehen habe ich
dann prompt zu breit ersetzt und drei echte Modulpfade mitgenommen (500er:
„Cannot find module 'rebrickable'"). Beide Fehler sind dieselbe Sorte:
derselbe Text, zwei völlig verschiedene Bedeutungen.

Diese Datei hält beide Seiten fest.
```

<a id="srcdirs"></a>
## `function srcDirs() {`

```text
Die zu prüfenden Quellordner — AUS DEM BAUSKRIPT gelesen, nicht hier
abgeschrieben.

── Warum (Nachtrag 139) ────────────────────────────────────────────────────
Hier stand eine feste Liste ['db','utils','routes','jobs','clients'].
`startup/` kam in Nachtrag 134 dazu — und fehlte hier. Sämtliche Prüfungen
dieser Datei übersprangen den Ordner also stillschweigend, darunter „jedes
späte require() zeigt auf eine Datei, die es gibt".

Genau dort standen zehn kaputte `require('./jobs/…')`, und weil sie in
setTimeout und .catch(() => {}) stecken, lief KEIN Hintergrundjob mehr an —
ohne eine einzige Fehlermeldung. Marco hat es gemeldet, nicht der Test.

Eine zweite Liste neben SRC_DIRS ist genau die Sorte Wahrheit, die
auseinanderläuft. Jetzt gibt es nur noch eine.
```

<a id="graph"></a>
## `const graph = new Map();`

```text
── Warum das eine eigene Prüfung verdient (Nachtrag 127) ─────────────────

Beim Auslagern der Anleitungs-Kette nach src/katalog/instructions.ts habe ich
selbst einen Kreis erzeugt: instructions braucht den Brickset-Client, und
der Client holte am Ende seiner Wiederholungsschlange Anleitungen nach.

Ein spätes `require()` hätte das überlebt — es läuft ja erst beim Aufruf.
Eine `import`-Anweisung nicht: Zur Ladezeit ist eine der beiden Seiten
`undefined`, und das fällt erst im Betrieb auf. Beim Umbau von require()
auf import wird aus einem harmlosen Kreis also ein Fehler, und genau
deshalb muss diese Richtung überwacht werden.

Aufgelöst wurde er, indem die Wiederholungsschlange als jobs/bricksetRetry.ts
eigenständig wurde: Sie ist Ablaufsteuerung, keine API-Anfrage.

Späte require() sind hier bewusst NICHT mitgezählt — die abzubauen ist ein
laufendes Vorhaben, aber sie sind zur Ladezeit ungefährlich.
```

<a id="build"></a>
## `const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build-ts.js'`

```text
── Zwei Beinahe-Ausfälle in Folge (Nachträge 126 und 128) ───────────────

Ein neuer Ordner muss an DREI Stellen bekannt sein, und keine davon meldet
sich, wenn sie fehlt:

  1. scripts/build-ts.js  → SRC_DIRS, sonst entsteht kein dist/<ordner>/
  2. Dockerfile           → COPY, sonst fehlt der Ordner im Build-Stage
  3. der Ladepfad zur Laufzeit

Bei clients/ habe ich (1) im letzten Moment gesehen und (2) erst beim
Durchsehen des Dockerfiles — im Container wäre der Server beim ersten
Import gescheitert. Das Projekt hatte denselben Fehler schon bei jobs/
(siehe test/jobs-typescript.test.js).
```

<a id="treffer"></a>
## `const treffer = [];`

```text
── Ein echter Laufzeitfehler beim Umzug (Nachtrag 131) ──────────────────

Beim Auslagern von addSet nach src/sets/setService.ts wanderte

    require('./parts').fetchMissingBlIds()

wortgleich mit. Aus utils/ gesehen gibt es './parts' nicht — der Aufruf
stand aber in einem `setImmediate(...)`, also flog der Fehler ERST beim
Anlegen eines Sets und ausserhalb jedes `.catch()`. Im Test tauchte er nur
als „asynchronous activity after the test ended" auf.

Die Prüfung require-exports.test.js sieht das nicht: Sie prüft, ob ein
Modul den NAMEN exportiert — nicht, ob es das Modul überhaupt gibt.

Verwandt mit dem Fund oben („kein Modul unter blossem Namen"), aber die
andere Hälfte: Dort war der Pfad zu kurz, hier zeigt er ins Leere.
```
