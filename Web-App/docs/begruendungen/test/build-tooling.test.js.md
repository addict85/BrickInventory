# Begründungen zu `test/build-tooling.test.js`

Die ausführlichen Kommentare aus `test/build-tooling.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="if-stelle"></a>
## `if (datei === 'web-ci.yml') {`

```text
── Und der Reporter, den die eingestellte Node-Fassung wirklich nimmt ──
`node --test` schrieb TAP („not ok"), als dieser Schritt entstand. Node
26 nimmt den spec-Reporter („✖ Name (12.3ms)"). GEMESSEN an Lauf 15:
Vier Tests rot, `grep '^not ok'` fand keinen einzigen, die vier Namen
standen in keiner Annotation. Der Web-Workflow muss deshalb BEIDE
Formen kennen; der Android-Workflow liest Gradle und hat damit nichts
zu tun.

Geprueft wird die ZUWEISUNG, nicht das blosse Vorkommen: Der Erklaertext
daneben nennt „✖ Name (12.3ms)" als Beispiel, und ein `assert.match(yml,
/✖/)` war damit schon durch seinen eigenen Kommentar erfuellt — beim
Gegenprobieren blieb er gruen. Dieselbe Falle wie mehrfach zuvor in
dieser Suite.
```

<a id="yml-stelle"></a>
## `const yml = fs.readFileSync(`

```text
── Der Befund ─────────────────────────────────────────────────────────
Hier stand `npm audit --omit=dev --audit-level=high` als eine Zeile.
GEMESSEN an Lauf 33867656667: Der Schritt lief GENAU 5:00 min und fiel
dann um; die einzige Annotation war „Process completed with exit code 1".
Das rohe Protokoll ist von hier aus nicht zu holen (der Ablageort liegt
hinter einer Weiterleitung, die der Proxy mit 403 ablehnt), also war
NICHT zu unterscheiden, ob eine echte Luecke gefunden wurde oder die
Registry nicht geantwortet hat. Lokal meldet derselbe Befehl in Sekunden
0 vulnerabilities.

Dieselbe Ueberlegung wie beim Testschritt: Eine Diagnose, die nur den
erwarteten Ausgang abdeckt, schweigt genau dann, wenn etwas Unerwartetes
passiert.
```

<a id="code"></a>
## `const code = yml.split('\n').filter(z => !z.trimStart().startsWith('#'`

```text
3. Die vier Schritte, die zusammen die Aussage tragen. `npm ci` statt
   `npm install` gehört dazu: nur ersteres scheitert, wenn package.json
   und Lockfile auseinanderlaufen.

   Gesucht wird im Workflow OHNE seine Kommentarzeilen. Der frühere Anker
   war `run:\s*npm test` — direkt hinter dem Schlüsselwort. Er sollte
   verhindern, dass die Begründungen im Fliesstext („npm ci statt npm
   install") die Prüfung von selbst erfüllen. Er hat aber auch etwas
   anderes festgeschrieben: dass der Befehl in DERSELBEN Zeile steht.

   Sobald der Testschritt ein mehrzeiliger Block wurde (`set -o pipefail`
   davor, `| tee` dahinter, damit ein roter Lauf lesbar bleibt), fand der
   Anker nichts mehr und meldete „ohne Tests ist der ganze Lauf sinnlos" —
   obwohl die Tests laufen. Kommentare wegzuschneiden erreicht dasselbe
   Ziel, ohne die FORM des Schrittes vorzuschreiben.
```

<a id="durchreicher"></a>
## `const DURCHREICHER = /\|\s*(tee|head|tail|cat)\b/;`

```text
── Gemessen, nicht vermutet ──────────────────────────────────────────────

    bash -c 'set -e;               (echo x; exit 1) | tee /dev/null' -> 0
    bash -c 'set -e -o pipefail;   (echo x; exit 1) | tee /dev/null' -> 1

In einer Kette ist der Rückgabewert der des LETZTEN Gliedes. `npm test |
tee protokoll` meldet also immer Erfolg, egal wie viele Tests rot sind.
GitHub startet `run:`-Blöcke mit `bash -e`, aber OHNE pipefail.

Der Testschritt benutzt genau diese Kette, damit ein roter Lauf lesbar
bleibt (das Container-Protokoll überdeckt am Ende die `not ok`-Zeilen).
Ohne die eine Zeile davor wäre der Preis dafür ein Workflow, der bei
gescheiterten Tests grün ist — schlimmer als gar keiner.

── Wonach genau gesucht wird ─────────────────────────────────────────────

Nicht nach JEDER Pipe. Der erste Entwurf tat das und meldete sofort einen
Fehlalarm: `[ "$X" = "true" ] || fehlt=…` ist ein logisches ODER, und
`--jq '.assets[] | select(…)'` ist ein Rohr INNERHALB von jq. Beide sind
harmlos, beide enthalten ein `|`.

Gefährlich ist die Kette, deren LETZTES Glied nur durchreicht: tee, head,
tail, cat. Dort will man den Rückgabewert von LINKS, bekommt aber den von
rechts — und der ist bei einem Durchreicher fast immer 0. Bei allen
anderen Ketten ist das letzte Glied das, worauf es ankommt.
```

<a id="dockerfile-und-ci-laufen-auf-derselben-u"></a>
## `test('Dockerfile und CI laufen auf derselben, unterstützten Node-Versi`

```text
Der Anlass (Nachtrag 152): Das Dockerfile lief auf `node:20-alpine`, und der
CI-Workflow schrieb `node-version: '20'` mit der Begründung „wie im
Dockerfile". Die Begründung war richtig, die Zahl falsch — Node 20 hatte am
30.04.2026 sein Lebensende erreicht und bekam seitdem keine
Sicherheits-Patches mehr. Ausgeliefert wurde also eine ungepatchte
Laufzeitumgebung, und CI prüfte brav dagegen.

Zwei Dinge werden hier festgehalten:

  1. Build-Stage, Runtime-Stage und CI nennen DIESELBE Hauptversion. Laufen
     sie auseinander, prüft CI etwas anderes als das, was läuft — und zwar
     still, weil beide für sich funktionieren.

  2. Die Version ist keine, deren Lebensende bekannt ist. Die Liste unten ist
     bewusst eine Liste ABGELAUFENER Zeilen und keine Liste erlaubter: Eine
     Erlaubnisliste müsste bei jeder neuen Node-Zeile nachgepflegt werden und
     würde einen Aufstieg auf 26 als Fehler melden. Eine Sperrliste altert in
     die richtige Richtung — sie wird nur ergänzt, wenn wirklich eine Zeile
     ausläuft.
```

<a id="verwaiste-sql-dateien-verschwinden-beim"></a>
## `test('verwaiste .sql-Dateien verschwinden beim naechsten Bau', async (`

```text
Eine Migration, die es in der Quelle nicht mehr gibt, liegt nach dem Bau
auch nicht mehr in dist/.

── Woher dieser Fall kommt ─────────────────────────────────────────────────

GEMESSEN, nicht ausgedacht: Beim Wechsel zwischen zwei Zweigen blieb ein
`0027-…sql` aus dem einen in dist/db/migrations/ liegen. db/migrate.ts liest
dist/ — der Läufer hat die Datei also ausgeführt, als wäre sie Teil des
Schemas. Zwölf Tests wurden rot, und die Suche ging zuerst in die eigene
Änderung statt in das Bauwerkzeug.

Das ist die teure Sorte Fehler: Der Befund zeigt nicht dorthin, wo die
Ursache liegt. Deshalb steht die Regel jetzt hier und nicht nur im
Kommentar von build-ts.js.

── Warum der echte Bau laeuft und kein Quelltextvergleich ──────────────────

Eine Pruefung „im Skript steht entferneVerwaiste()" waere eine Aussage ueber
den Text. Die Abbildung Quelle → Ziel wird in copyAssets() vorwaerts und in
entferneVerwaiste() rueckwaerts gerechnet; dass die beiden Rechnungen
zueinander passen, sieht man nur, wenn man sie ausfuehrt. Gebaut wird in ein
TEMPORAERES Verzeichnis, nicht nach dist/ — der Lauf greift damit keinem
anderen Test ins Werk.
```
