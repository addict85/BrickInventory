# Begründungen zu `test/workflow-ort.test.js`

Die ausführlichen Kommentare aus `test/workflow-ort.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein Workflow, der nicht im Wurzelverzeichnis liegt, läuft NIE.

── Der Befund ──────────────────────────────────────────────────────────────

`Web-App/.github/workflows/ci.yml` war ein vollständiger, sorgfältig
geschriebener CI-Lauf: echtes PostgreSQL in der Hauptversion aus dem
Betrieb, REQUIRE_DB=1, `npm ci` aus dem Lockfile, Typprüfung, Bau, Tests,
`npm audit`. Sein Kopfkommentar beschreibt genau den Fehler, gegen den er
gebaut wurde: „die zehn Prüfungen darunter liefen monatelang nicht".

Er ist nie gelaufen. Kein einziges Mal.

GitHub liest Workflows AUSSCHLIESSLICH aus `.github/workflows/` im
Wurzelverzeichnis des Repositories. In einem Unterordner ist so eine Datei
nichts als Text. NACHGEMESSEN über die Actions-API — das Repository kannte
drei Workflows:

    .github/workflows/android.yml
    .github/workflows/android-playstore.yml
    .github/workflows/docker-publish.yml

(Der mittlere ist inzwischen entfernt — die App wird als APK ueber die
GitHub-Releases ausgeliefert. Die Aufzaehlung bleibt, wie sie gemessen wurde.)

Und `test/build-tooling.test.js` bewachte den INHALT dieser Datei die ganze
Zeit zuverlässig — es zeigte nur auf etwas, das niemand ausführt. Dass eine
Prüfung grün ist, sagt eben nur etwas über das, worauf sie zeigt.

── Warum gesucht und nicht aufgezählt ──────────────────────────────────────

Gesucht wird im GANZEN Baum nach `.github/workflows/`. Ein neuer Ordner an
einer neuen Stelle ist damit von selbst mitgeprüft — eine Liste erlaubter
Orte hätte genau den einen Fall nicht gefunden, um den es hier geht.

Selbstbeweis über eine Mindestzahl: Fände der Durchlauf gar nichts, wäre die
Prüfung leer und trotzdem grün — dieselbe Falle wie oben, eine Ebene höher.
```

<a id="stelle"></a>
## `assert.ok(dateien.length >= 3,`

```text
Selbstbeweis 2: Eine Mindestzahl statt einer Aufzählung. Verschwände der
Ordner oder griffe das Muster nicht, wäre die Liste leer — und die
Prüfung darunter hätte nichts zu sagen.

Von 4 auf 3 gesenkt, als android-playstore.yml entfernt wurde. Die Zahl ist
eine Untergrenze gegen „gar nichts gefunden", keine Aussage darüber, wie
viele Workflows es geben soll — deshalb wird sie der Wirklichkeit
nachgezogen und nicht umgekehrt. Gemessen sind es android.yml,
docker-publish.yml, web-ci.yml.
```

<a id="fassungen"></a>
## `const fassungen = new Map();   // Action -> Map(Fassung -> [Dateien])`

```text
── Warum ──────────────────────────────────────────────────────────────────
In android.yml steht ein langer, nachgemessener Absatz dazu, warum
upload-artifact auf v6 gehoben wurde: v4 und v5 laufen auf Node 20 und
warnen, erst v6 läuft auf Node 24. Die Recherche wurde einmal gemacht,
aufgeschrieben — und docker-publish.yml blieb auf v4 stehen.

Zwei Fassungen derselben Regel, wieder. Diese Prüfung sagt nicht, WELCHE
Fassung richtig ist (das hängt am Tag ab und steht in android.yml), nur
dass es eine ist.
```

<a id="testbefehle"></a>
## `const TESTBEFEHLE = [/npm\s+test/, /testDebugUnitTest/];`

```text
── Warum (Nachtrag 125) ───────────────────────────────────────────────────

android.yml stand auf `push: branches: [main]`, web-ci.yml daneben auf
`branches: ['**']`. Dieselbe Regel in zwei Fassungen — und die App zog den
Kürzeren.

GEMESSEN: In der Sitzung, aus der diese Prüfung stammt, gingen vier Pushes
mit Android-Änderungen auf einen Zweig. Die Web-CI lief viermal von selbst,
der Android-Lauf kein einziges Mal. Dreimal war er rot, als er endlich von
Hand angestossen wurde — der Fehler lag jedes Mal längst im Zweig.

Der Zweig ist genau der Ort, an dem der Befund gebraucht wird: bevor etwas
nach main geht. Ein Lauf, der erst auf main prüft, sagt es zu spät.

GESUCHT, nicht aufgezählt: Betroffen ist jeder Workflow, der TESTS
AUSFÜHRT — erkannt am Testbefehl in seinen Schritten, nicht an seinem
Namen. Ein neuer Testlauf ist damit von selbst mitgeprüft.

Und NUR, wenn er überhaupt auf Push reagiert. Die erste Fassung dieser
Prüfung liess das weg und meldete prompt den damaligen
android-playstore.yml: Der führte `testDebugUnitTest` aus, wurde aber
ausschliesslich von Hand angestossen (`workflow_dispatch` mit der Play-Spur
als Eingabe). „Läuft nicht auf jedem Zweig-Push" ist bei einem Lauf ohne
Push-Auslöser keine Aussage — das wäre eine erfundene Regel gewesen, und die
meldet nur Rauschen. Veröffentlichungsläufe sollen auf ein Etikett oder
einen Knopf warten.

Jener Workflow ist inzwischen entfernt. Die Einschraenkung bleibt: Sie ist
richtig, unabhaengig davon, ob es gerade einen solchen Lauf gibt — und der
naechste Veroeffentlichungslauf findet sie vor, statt sie neu zu brauchen.
```
