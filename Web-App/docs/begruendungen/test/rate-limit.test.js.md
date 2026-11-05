# Begründungen zu `test/rate-limit.test.js`

Die ausführlichen Kommentare aus `test/rate-limit.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Tageslimit für Rebrickable-API-Aufrufe.

Zwei Dinge waren hier auseinandergelaufen:

  1. Der gespeicherte Wert (global_settings.api_limit_rebrickable) wurde
     ausschliesslich im PUT-Handler von /api/v1/admin/api-limits per setMax()
     in den Limiter geschrieben. Beim Serverstart passierte das nicht — nach
     jedem Neustart galt wieder der hartkodierte Konstruktorwert, egal was in
     den Einstellungen stand.
  2. Die Fehlertexte in clients/rebrickable.ts nannten "100/Tag", während das
     tatsächliche Limit längst bei 4000 lag. Gleiches Muster in den
     Monitor-Labels (i18n) und im Standardwert des Eingabefelds.

Der Test hält Standardwert und Verdrahtung zusammen, damit sie nicht wieder
getrennt driften. Ohne DB. Ausführen: npm test
```

<a id="fc-stelle"></a>
## `const fc = fs.readFileSync(path.join(ROOT, 'src/katalog/apiKontingent.`

```text
getLimitForApi() hatte eine eigene Kopie des Rückfallwerts (4000). Solange
Rebrickable seinen eigenen Zähler hatte, sah es diese Tabelle nie — seit
beide über checkAndIncrementRateLimit laufen, wäre es eine stille Kürzung
auf ein Sechstel gewesen. Zwei Konstanten mit derselben Bedeutung driften
auseinander; hier wird festgehalten, dass es nur noch eine gibt.
Seit die Zähler in src/katalog/apiKontingent.ts stehen, steht dort auch die Konstante.
```

<a id="rl-stelle"></a>
## `const rl = fs.readFileSync(path.join(ROOT, 'src/katalog/rateLimiter.ts`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
Der Rebrickable-Zähler lag in `this.count` einer DailyLimiter-Instanz —
also im Speicher EINES Prozesses. Der Server läuft im Cluster: Jeder
Worker legte seine eigene Instanz an und zählte für sich bis zum Limit.
Bei WORKERS = max(2, CPU-Kerne) waren auf einem Vierkerner 100'000 Aufrufe
möglich, wo 25'000 eingestellt sind. Die DB-Schreibvorgänge täuschten
Gemeinsamkeit vor, überschrieben aber nur den Stand des jeweils letzten
Workers.

Genau dasselbe war beim Login-Zähler schon behoben worden (Test weiter
unten: „die Login-Zähler liegen nicht mehr im Prozessspeicher"), und für
BrickLink und Brickset war es von Anfang an richtig. Rebrickable war die
dritte Instanz desselben Musters.

Gegen echte Datenbank nachgestellt: Limit 3, drei Aufrufe erlaubt, der
vierte abgelehnt — und ein zweiter Modulzustand (= zweiter Worker) fängt
NICHT wieder bei null an.
```

<a id="server"></a>
## `const server = require('./helpers/sources').serverAll().replace(/\/\/[`

```text
Und das Nachladen beim Start ist entfallen — die Grenze wird bei jedem
Aufruf gelesen, statt in einen Prozessspeicher kopiert zu werden.
Kommentare raus: Die Notiz an der alten Stelle nennt den Namen weiterhin
(sie erklärt ja, warum dort nichts mehr steht) — ohne das Ausblenden hielte
der Test den Kommentar für den Aufruf. Dieselbe Falle wie schon zweimal
zuvor in dieser Suite.
```

<a id="admin"></a>
## `const admin = fs.readFileSync(path.join(ROOT, 'routes/api_v1/admin.ts'`

```text
Vorher: PUT /api/v1/admin/api-limits rief setMax() auf — das galt nur im
Worker, der die Anfrage bearbeitet hat. Die übrigen liefen bis zum
Neustart mit dem alten Wert weiter, und beim Start musste
loadDailyLimitsFromDb() den Wert in jeden Prozess kopieren.

Jetzt liest getLimitForApi() die Grenze bei jedem Aufruf aus
global_settings — kein Kopieren, kein Nachziehen, keine Abweichung
zwischen Workern.
```

<a id="dateien"></a>
## `const dateien = (dir) => fs.readdirSync(dir, { withFileTypes: true }).`

```text
checkLoginAllowed ist seit der Umstellung asynchron — ein vergessenes
await liefert ein Promise, das immer truthy ist und JEDEN Login sperrt.

Hier standen zwei Dateinamen. Das ging gut, solange die Anmeldung an genau
diesen zwei Stellen stand; als sie in src/konto/auth.ts zusammengezogen wurde,
prüfte der Test Dateien, in denen es nichts mehr zu prüfen gab, und
meldete das Zusammenlegen als Fehler. Gesucht wird deshalb im Baum.
```

<a id="job-stelle"></a>
## `const job = (fs.readFileSync(path.join(ROOT, 'jobs/priceJob.ts'), 'utf`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
Der Preis-Job schützte sich mit `state.running` — einer Variablen im
Speicher EINES Prozesses. Geplant lief er nur im Primary-Worker, aber die
beiden manuellen Auslöser (POST /api/finance/job-trigger und
POST /api/v1/admin/trigger-price-job) laufen in dem Worker, der die
Anfrage bearbeitet. Dort war state.running false — also startete ein
vollständiger Lauf über alle Sets, unabhängig davon, ob im Primary gerade
einer lief. Zwei Klicks auf verschiedenen Workern ergaben zwei komplette
Durchgänge, jeder mit eigenen BrickLink-Aufrufen, und beide schrieben in
dasselbe Fortschrittsfeld.

Mit einem ECHTEN zweiten Prozess nachgestellt (eigener Speicher,
state.running dort false): mit Sperre wird er abgewiesen, ohne Sperre
startet er mit.

Das war die vierte Instanz desselben Musters — nach Login-Zähler,
Bild-Cache-Aufräumlauf und Rebrickable-Tageskontingent. Deshalb prüft
dieser Test die REGEL: Wer ein externes Kontingent verbraucht und aus
einer Route angestossen werden kann, braucht mehr als eine Variable im
Prozessspeicher.
Kommentare raus, BEVOR geprüft wird: Der Erklärtext in priceJob.ts nennt
pg_try_advisory_xact_lock (als das, was dort bewusst NICHT benutzt wird) —
ohne das Ausblenden schlüge die Prüfung darauf am Kommentar an. Dieselbe
Falle wie mehrfach zuvor in dieser Suite; sie ist der häufigste Fehler
beim Schreiben quelltextlesender Tests.
```

<a id="stelle"></a>
## `assert.match(job, /LOCKS\.PREIS_JOB/,`

```text
Der Namensraum kommt aus der gemeinsamen Liste.

Hier stand bis Nachtrag 149 eine von Hand gepflegte Abschrift:
    const belegt = ['42', '77', '11223344', '99999999'];
Sie kannte 55, 56, 57 und 58 nicht, obwohl es alle vier längst gab — eine
Kollision mit dreien davon wäre durchgegangen, und der Test wäre dabei
grün geblieben. Dass die Namensräume sich wirklich nicht behindern, misst
jetzt test/lock-namespaces-db.test.js gegen eine echte Datenbank.
```
