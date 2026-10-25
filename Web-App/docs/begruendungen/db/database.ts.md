# Begründungen zu `db/database.ts`

Die ausführlichen Kommentare aus `db/database.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
PostgreSQL database layer

Provides a synchronous-style interface compatible with the existing
better-sqlite3 usage throughout the codebase.

Since pg is async but the rest of the code uses sync patterns,
we use a connection pool with a sync-compatible wrapper via
a shared client approach for transactional operations.

Environment variables:
  PGHOST     (default: postgres)
  PGPORT     (default: 5432)
  PGUSER     (default: brickmanager)
  PGPASSWORD (default: brickmanager)
  PGDATABASE (default: brickmanager)
  DATABASE_URL (overrides all above if set)
```

<a id="abschnitt-2"></a>
## Abschnitt

```text
── Warum diese acht jetzt oben stehen (Nachtrag 155) ────────────────────────

Sie standen als require() in den Funktionsruempfen. Node haelt Module im
Cache, die Laufzeitkosten waren also gering — der Preis war ein anderer: Die
Abhaengigkeiten dieser Datei standen nicht an ihrem Kopf, und ein require()
ohne Typdeklaration liefert `any`. In der Datei, die Schema, Migrationen und
das Admin-Startpasswort verantwortet, ist das die falsche Stelle zum Sparen.

NICHT gehoben: ../utils/partsSummary (Ladezyklus, Begruendung an der Stelle
selbst) und ../package.json — das ist keine Abhaengigkeit des Moduls,
sondern ein Lesevorgang mit Rueckfall.
```

<a id="abschnitt-3"></a>
## Abschnitt

```text
── NUMERIC kommt als Zahl zurück, nicht als Zeichenkette ───────────────────

Seit db/migrations/0007 liegen alle Geldbeträge als NUMERIC in der Datenbank
statt als REAL — sonst rechnet Postgres in 32-Bit-Gleitkomma, und die Summe
aus 1000 Beträgen à 0.07 ergibt 69.99974 statt 70.00.

Der pg-Treiber liefert NUMERIC standardmässig als ZEICHENKETTE, weil der
Typ mehr Stellen darstellen kann als eine JavaScript-Zahl. Ohne diesen
Parser würde aus `preis * menge` schlagartig eine Zeichenketten-Multiplikation
an hunderten Stellen — und wo bisher `0` stand, stünde `"0.0000"`, was in
einer if-Abfrage wahr ist. Genau diese Sorte stiller Fehler soll die
Umstellung nicht eintauschen.

Deshalb: NUMERIC wird beim Lesen zu einer JavaScript-Zahl. Der Gewinn bleibt
vollständig erhalten, denn er liegt beim SPEICHERN und beim RECHNEN IN DER
DATENBANK — dort ist jetzt alles exakt dezimal. Eine JavaScript-Zahl trägt
gut 15 signifikante Stellen; Beträge in dieser Anwendung brauchen höchstens
zehn.
```

<a id="querywithretry"></a>
## `queryWithRetry`

```text
Eine Abfrage mit Wiederholung bei transienten Fehlern ausführen.

Generisch typisiert, damit der Rückgabetyp der übergebenen Funktion
durchgereicht wird. Ohne das leitete TypeScript unter strictNullChecks an
vielen Aufrufstellen `never` ab — und meldete dann Folgefehler der Art
"Property 'name' does not exist on type 'never'", die wie ein Problem der
Aufrufstelle aussehen, aber alle hierher zurückführten.

@template T
@param {() => Promise<T>} queryFn
@param {number} maxRetries
@returns {Promise<T>}
```

<a id="abschnitt-4"></a>
## Abschnitt

```text
Alle Zeilen einer Abfrage.

Rückgabetyp bewusst `any[]` und nicht generisch: Die Aufrufstellen greifen
auf Spalten zu, deren Namen erst im SQL stehen. Ein generischer Parameter
würde an jeder der rund 400 Aufrufstellen eine Typangabe verlangen, ohne dass
jemand sie pflegt — und eine gepflegte Lüge ist schlechter als ein ehrliches
any. Wichtig ist, dass es NICHT `never` oder `unknown` ist (siehe
queryWithRetry).
```

<a id="dbschnittstelle"></a>
## `DbSchnittstelle`

```text
Die Abfrage-Schnittstelle, die dieses Modul anbietet — einmal als Typ.

── Warum benannt statt inline (Nachtrag 155) ────────────────────────────────
transaction() reicht dem Rueckruf ein Objekt mit genau diesen vier Methoden.
Beide Seiten hatten bisher keinen Typ: Der Rueckruf-Parameter war implizit
`any`, damit war jeder Aufruf darin ungeprueft — auch `tx.gett(...)` waere
durchgegangen und erst zur Laufzeit als "is not a function" aufgeschlagen.
Als Typ steht die Zusage einmal geschrieben, und die transaktionsgebundene
Fassung muss sie einhalten.
```

<a id="abschnitt-5"></a>
## Abschnitt

```text
── SQL dialect translation (entfernt) ────────────────────────────────────────
Hier stand eine SQLite→PostgreSQL-Übersetzung aus der Migrationszeit. Sie ist
ersatzlos entfallen, weil sie zwei Klassen stiller Fehler produziert hat:

  1. Sie hat an JEDES INSERT ohne ON CONFLICT automatisch
     " ON CONFLICT DO NOTHING" angehängt. Damit wurden Unique-Verletzungen
     global verschluckt: `POST /api/auth/users` meldete `success: true`,
     obwohl kein Nutzer angelegt wurde, und der 23505-Zweig im catch war
     toter Code. Ausserdem war deshalb "INSERT … RETURNING" verboten, was
     db.run()s lastID dauerhaft auf null festgenagelt hat.
  2. Sie hat JEDES Fragezeichen durch $n ersetzt — auch in String-Literalen
     ("LIKE '%?%'") und in den JSONB-Operatoren ?, ?| und ?&. Bei
     csv_import_jobs.results (JSONB) ist das keine Theorie.

Voraussetzung für die Entfernung (geprüft): es gibt in der Codebasis kein
"INSERT OR IGNORE/REPLACE", kein datetime(), kein GLOB und keinen einzigen
?-Platzhalter mehr — alle Queries sind bereits nativ PostgreSQL mit
$n-Platzhaltern. Jedes INSERT, das idempotent sein soll, trägt sein
ON CONFLICT jetzt sichtbar an der Aufrufstelle.

Die Funktion selbst ist jetzt ebenfalls weg. Sie blieb zuletzt als
Identitätsfunktion bestehen ("könnte mal ein Hook für Query-Timing werden") —
das kostete auf jedem Query-Pfad einen Aufruf und suggerierte beim Lesen,
dass hier noch etwas übersetzt wird. Ein Hook lässt sich einbauen, wenn er
gebraucht wird; bis dahin ist das Nichts ehrlicher.
```

<a id="schemasql"></a>
## `_schemaSql`

```text
Das Grundschema von der Platte lesen.

Einmal je Prozess: Beim Start rufen mehrere Arbeitsprozesse initSchema(),
und die Datei ändert sich zur Laufzeit nicht.

Der Pfad geht über __dirname, NICHT über APP_ROOT.

Mein erster Versuch nahm APP_ROOT und wäre im Container gescheitert: Das
Laufzeit-Image enthält nur dist/ — die Quellen bleiben im Build-Stage
zurück. `${APP_ROOT}/db/schema.sql` gibt es dort also gar nicht.

Dass die Datei überhaupt in dist/ landet, besorgt scripts/build-ts.js: Es
kopiert .sql-Dateien ausdrücklich mit (ASSET_EXT) — eine Vorkehrung, die
dieses Projekt schon einmal teuer gelernt hat. db/migrate.ts macht es aus
demselben Grund genauso.
```

<a id="abschnitt-6"></a>
## Abschnitt

```text
Das Schema anlegen und auf den aktuellen Stand bringen.

── Warum in Etappen (Nachtrag 148) ─────────────────────────────────────────
Die Funktion war 408 Zeilen lang und tat fünf verschiedene Dinge
hintereinander. Wer eine davon suchte, las die anderen vier mit; und die
REIHENFOLGE — die hier eine echte Bedingung ist und nicht nur Gewohnheit —
stand nur als Kommentar mitten im Rumpf.

Jetzt steht sie als Liste. Die Regel dahinter: Erst alle Tabellen und
Spalten, dann die Indizes. Ein Index auf eine Spalte, die eine spätere
ALTER-Migration erst anlegt, scheitert bei einer Neuinstallation mit
"column does not exist".
```

<a id="geschluckt"></a>
## `_geschluckt`

```text
Ein Schema-Schritt, der den Start NICHT abbrechen soll — aber gezaehlt wird.

── Marcos Befund vom 25.09., und warum er so lange hielt ──────────────────

Der Teile-Reiter antwortete mit „column storage does not exist", obwohl
initSchema() nachweislich gelaufen war. Die Spalte entsteht in
initPartsSummary(), und dessen Fehlschlag wurde hier geschluckt:

    .catch(schlucke('parts_summary'))

Das allein waere ertraeglich. Der eigentliche Fehler steht eine Ebene
darueber: initSchemaOnce() vermerkt danach die Fassung in schema_meta —
BEDINGUNGSLOS. Ein einmaliger Fehlschlag wurde damit als Erfolg gebucht,
und weil initSchema() nur bei einer Versionsaenderung erneut laeuft, war die
Spalte fuer immer weg. Aus einem voruebergehenden Problem wurde ein
dauerhafter Zustand.

Ein plausibler Ausloeser: ALTER TABLE braucht eine ACCESS-EXCLUSIVE-Sperre,
der Pool setzt statement_timeout=30s (siehe oben), und beim Austausch des
Containers haelt der alte noch Sperren auf genau dieser Tabelle. Bewiesen
ist das nicht — beweisbar waere es allein aus dem Protokoll jenes Starts,
an der Zeile „[db] parts_summary: …". Deshalb steht hier keine Behauptung
ueber die Ursache, sondern eine Aenderung am Umgang mit ihr.

── Was sich aendert ───────────────────────────────────────────────────────

Geschluckt wird weiter — ein fehlender Index soll den Server nicht am
Starten hindern. Aber es wird gemerkt, und initSchemaOnce() vermerkt die
Fassung nur, wenn NICHTS geschluckt wurde. Der naechste Start versucht es
dann erneut, statt den halben Stand fuer erledigt zu halten.

Zwei Stellen zaehlen mit, ohne gelesen zu werden: die beiden Bild-Dienste
laufen in JEDEM Arbeitsprozess und erst NACH dem Vermerk. Ihr Eintrag
landet im Feld und wird nie abgefragt. Das ist kein Versehen, sondern der
Preis dafuer, dass alle Schluckstellen gleich aussehen — eine Ausnahme
waere eine Stelle, an der jemand spaeter den falschen Helfer nimmt.
```

<a id="preisverlaufeindeutigprotag"></a>
## Abschnitt

```text
── Ein Preiseintrag je Set, Zustand, Währung und TAG ───────────────────────

Zwei Schreibwege (jobs/priceJob.ts beim Abruf, utils/financeCalc.ts) tragen
`ON CONFLICT DO NOTHING` — die Tabelle hatte aber nur den Primärschlüssel
auf id. Ohne passenden Unique-Index kann die Klausel nie greifen: Sie liest
sich wie ein Schutz gegen Dubletten und ist keiner. Jede Preisabfrage legte
eine weitere Zeile an, und die Portfolio-Kurve liest sie alle.

Der Index macht die Klausel wahr. `recorded_at::date` wäre nicht
unveränderlich (hängt an der Zeitzone der Sitzung) und dürfte nicht in
einen Index — deshalb ausdrücklich in UTC.

Vorhandene Dubletten müssen vorher weg, sonst scheitert das Anlegen. Es
gewinnt der jüngste Eintrag des Tages; genau den hätte die Auswertung auch
genommen.
```

<a id="spaltenmigrationen-setsmigrations"></a>
## `setsMigrations`

```text
── Migrations: add columns to existing tables ──────────────────────────────
sets table migrations

purchase_price und condition stehen hier weiterhin, obwohl Migration 0032
sie loescht — und das ist kein Versehen: initSchema() laeuft NUR beim
allerersten Start, und danach laufen alle Migrationen der Reihe nach.
Migration 0007 schreibt `ALTER TABLE sets ALTER COLUMN purchase_price TYPE
NUMERIC`, und das ist auf einer fehlenden Spalte ein harter Fehler
(GEMESSEN: der erste Start einer frischen Datenbank brach damit ab).
0032 raeumt sie am Ende derselben Kette weg. Die Begruendung steht
ausfuehrlich in db/schema.sql an der sets-Tabelle.

Auf einer LAUFENDEN Datenbank gibt es die beiden Spalten nicht: Diese
Schleife kommt dort nie mehr vorbei.
```

<a id="spaltenmigrationen"></a>
## Abschnitt

```text
Make sure existing admin user is marked as active + verified
Mit Protokoll: Scheitert eine dieser beiden, bleibt ein Konto inaktiv oder
unbestaetigt und niemand kann sich anmelden — der Grund stuende nirgends.
Die Spaltenmigrationen darueber melden ihren Erfolg ebenfalls.

── `IS NULL` statt bedingungslos ─────────────────────────────────────────

Gedacht war die Anweisung fuer Datenbanken, auf denen die beiden Spalten
gerade erst per ALTER TABLE dazugekommen sind — dort stehen sie auf NULL.
Geschrieben war sie bedingungslos, und damit setzte sie auch eine
ABSICHTLICHE 0 zurueck: Ein abgeschaltetes Administratorkonto waere bei
jedem Lauf von initSchema() wieder freigeschaltet worden.

Heute laeuft initSchema() nur beim Erststart, dort ist der Unterschied
gegenstandslos. Der Riegel steht fuer FORCE_SCHEMA_INIT=1 — einen
Notausgang, hinter dem keine Tretmine liegen soll. Die ursprueglich
gemeinte Wirkung bleibt vollstaendig erhalten.
```

<a id="abschnitt-7"></a>
## Abschnitt

```text
── api_tokens.sliding und die beiden Indizes stehen in einer MIGRATION ───

Hier stand ein `ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS sliding`
mit einem `.catch(warn)` daneben. Im Betrieb hat das die ANMELDUNG
zerlegt: createToken() schreibt die Spalte beim Login und beim QR-Login,
und auf Marcos Server gab es sie nicht.

Zwei Gruende, beide stehen als Warnung schon in dieser Datei:
  1. initSchema() laeuft NUR bei einer Versionsaenderung — steht in
     schema_meta bereits die Fassung dieses Deployments, wird der ganze
     Block uebersprungen.
  2. Der `.catch(warn)` machte einen einmaligen Fehlschlag dauerhaft: Die
     Version wird anschliessend trotzdem als angewandt vermerkt.

Genau davor warnt der Absatz am Ende dieser Funktion ueber die
Bild-Tabellen, und initSchemaOnce() sagt es ausdruecklich: nummerierte
Migrationen „laufen IMMER … und sind die Stelle, an der ab jetzt jede
Schemaaenderung landet". Sie stehen deshalb in
db/migrations/0015-api-tokens-sliding.sql — dort laufen sie in einer
Transaktion, mit eigener Buchfuehrung, und ein Fehlschlag bricht den Start
ab, statt still zu bleiben.
```

<a id="frueherzurlaufzeitangelegt"></a>
## Abschnitt

```text
Default admin user

VORHER: Immer 'admin' / 'admin'. Das ist kein Startwert, den man später
ändert, sondern ein öffentlich bekanntes Credential — jede erreichbare
Installation, deren Betreiber den Login-Screen nicht sofort besucht, ist
damit sofort übernehmbar (Shodan-Scans nach genau diesem Muster sind
Alltag). Jetzt: ADMIN_PASSWORD aus der Umgebung, falls gesetzt (für
automatisierte Deployments); sonst ein zufälliges Passwort, das NUR beim
allerersten Start in die Logs geschrieben wird und dessen Konto als
"muss geändert werden" markiert ist (must_change_password s.o.).
```

<a id="frueherzurlaufzeitangelegt-banner"></a>
## `banner`

```text
── NICHT über console.log ──────────────────────────────────────────

„NUR JETZT sichtbar" stimmte nicht mehr: Der Log-Abfänger in server.ts
schreibt JEDE Konsolenzeile nach app_logs, und der Admin-Log-Viewer
(GET /api/v1/admin/logs) gab das Passwort 48 Stunden lang im Klartext
wieder aus — mitsamt jedem Datenbank-Backup aus diesem Zeitraum.

Direkt auf stdout geschrieben, geht die Zeile am Abfänger vorbei und
steht nur dort, wo sie hingehört: im Container-Log des ersten Starts.
Ein Filter im Abfänger wäre die Alternative gewesen — der hinge dann
an einer Zeichenkette, die jemand später umformuliert.
```

<a id="frueherzurlaufzeitangelegt-partscondexists"></a>
## `partsCondExists`

```text
── Migration: condition column for parts (manual parts) ────────────────

Steht hier weiter, obwohl Migration 0035 die Spalte loescht — und das ist
kein Versehen, sondern dieselbe Begruendung wie bei sets.purchase_price
(siehe spaltenMigrationen weiter oben): Diese Funktion legt den
AUSGANGSZUSTAND einer neuen Datenbank, danach laufen die numerierten
Migrationen der Reihe nach. Der Nachtrag in 0035 LIEST parts.condition,
um sie in die Erfassung zu tragen; fehlte die Spalte auf einer frischen
Datenbank, braeche er ab.

Auf einer LAUFENDEN Datenbank kommt dieser Block nie mehr vorbei.
```

<a id="frueherzurlaufzeitangelegt-2"></a>
## Abschnitt

```text
── Nachtragen: erst hier, NACH den Spaltenmigrationen ──────────────────

Diese beiden Bloecke standen weiter oben, VOR den ALTER TABLEs, die
parts.added_at und parts.condition anlegen. Auf jeder Datenbank, die
diese Spalten noch nicht hatte — also bei jedem Hochziehen von einem
aelteren Stand —, lief der Teile-Nachtrag damit gegen eine Spalte, die es
erst zwei Bloecke spaeter gab, und scheiterte. Lautlos, denn der Fehler
wurde verschluckt. Beim naechsten Start war die Spalte da und es klappte:
ein Start ohne Nachtrag, ohne dass es jemand erfuhr.

Der Sets-Nachtrag direkt darunter stand immer schon an der richtigen
Stelle. Von dreien war einer richtig einsortiert und zwei nicht.
── Hier stand der Nachtrag „manuelle Teile und Figuren ohne Erfassung ──
── bekommen eine" — er ist weg, und zwar weil er nie etwas getan hat ───

Dieselbe Begruendung, die beim Sets-Nachtrag ein Stueck weiter unten schon
ausgeschrieben steht: initSchema() laeuft NUR beim allerersten Start einer
Datenbank (siehe initSchemaOnce — das Tor ist „hat schema_meta ueberhaupt
eine Zeile", kein Versionsvergleich), und dort sind `parts` und `minifigs`
leer. Gedacht war er fuer Altbestaende und hat sie niemals erreicht.

Schlimmer noch waere er ab jetzt: Migration 0035 loescht unit_price,
purchase_price und condition aus beiden Tabellen. Bei einem Start mit
FORCE_SCHEMA_INIT=1 liefe er danach gegen geloeschte Spalten — und sein
logAndContinue() wuerde das verschlucken.

Wo er gebraucht wird, steht er jetzt richtig: Migration 0035 traegt die
fehlenden Erfassungen nach, einmalig, und prueft danach nach, dass keine
manuelle Position ohne Erfassung und kein Kaufpreis uebrig bleibt — bevor
sie die sechs Spalten loescht.
```

<a id="abschnitt-8"></a>
## Abschnitt

```text
Hier stand der Nachtrag „bestehende Sets ohne Kaufpreis-Historie bekommen
genau eine Acquisition-Zeile (Menge/Preis/Datum vom Set)". Er ist weg, und
zwar weil er nie etwas getan hat: initSchema() laeuft NUR beim allerersten
Start einer Datenbank (siehe initSchemaOnce), und dort ist `sets` leer. Der
Nachtrag war fuer Altbestaende gedacht und hat sie niemals erreicht.

Wo er gebraucht wird, steht er jetzt richtig: Migration 0032 traegt die
fehlenden Erfassungen nach, einmalig, und prueft danach nach, dass keine
Set-Zeile ohne Erfassung uebrig ist — bevor sie die beiden Spalten loescht.
```

<a id="indizesundzusammenfassung"></a>
## `indizesUndZusammenfassung`

```text
Etappe 5 — Indizes und die vorberechnete Teile-Zusammenfassung.

ZULETZT, und das ist keine Stilfrage: Erst wenn alle Tabellen stehen und
alle ALTER-Migrationen durchgelaufen sind, referenziert ein Index garantiert
nur vorhandene Spalten. Sonst scheitert eine Neuinstallation an
"relation/column does not exist", sobald jemand weiter oben eine Spalte
ergänzt.
```

<a id="indizesundzusammenfassung-2"></a>
## Abschnitt

```text
── Drei Nachschläge im Anfragepfad, die keinen passenden Index hatten ─────

Alle drei mit EXPLAIN (ANALYZE, BUFFERS) an je 100'000 Zeilen nachgemessen.

 1. parts — der BrickLink-Rückfall in resolveBlPartNumber
    (utils/financeCalc.ts). Er läuft EINMAL JE TEIL der Bewertung:
        ohne Index   Seq Scan,   2479 Buffer, 10,1   ms
        mit  Index   Index Scan,    2 Buffer,  0,012 ms
    Bei 500 manuellen Teilen sind das rund fünf Sekunden allein hier.
    TEILINDEX: Kandidat ist nur, wer überhaupt eine BrickLink-Nummer hat,
    und genau danach fragt die Abfrage. Deshalb 8 KB statt Megabyte — das
    Prädikat muss zeichengleich zur WHERE-Bedingung sein, sonst nimmt der
    Planer den Index nicht.

 2. set_minifigs_catalog nach fig_number (routes/api_v1/minifigs.ts):
        ohne Index   Seq Scan,    572 Buffer, 5,19  ms
        mit  Index   Index Scan,    4 Buffer, 0,041 ms   (Index 3 MB)
    Vorhanden waren (set_number) und (set_number, fig_number). Beide haben
    set_number als FÜHRENDE Spalte und können eine Suche allein nach
    fig_number nicht bedienen — ein zusammengesetzter Index hilft nur von
    links.

 3. sets nach set_number OHNE user_id (routes/api_v1/admin.ts, „welche
    Konten besitzen dieses Set?"). Derselbe Grund: idx_sets_user_setnum
    beginnt mit user_id, das die Abfrage nicht nennt — sie liest sonst die
    Sets aller Konten.
Angelegt werden sie in db/migrations/0015-api-tokens-sliding.sql, aus
demselben Grund wie die Spalte dort: Auf einer Datenbank, deren
schema_meta schon die laufende Fassung traegt, laeuft initSchema() gar
nicht — die Indizes waeren nie entstanden, und niemand haette es gemerkt,
weil nichts scheitert. Nur die Messung oben bleibt hier stehen; sie
begruendet, WARUM es sie gibt.
Kategorie-Filter/-Aggregation: beschleunigt GROUP BY category_name im
/categories-Endpoint und den Kategorie-Filter der Teileliste (beide je User).
rb_part_categories selbst braucht keinen Extra-Index: die Auflösung läuft über
den PRIMARY KEY (id), und die Tabelle ist mit ~65 Zeilen ohnehin winzig.
Gemeinsame Zähler für Brute-Force- und Missbrauchsschutz. Vorher lagen sie
im Prozessspeicher, womit bei N Cluster-Workern effektiv N×5 Versuche
möglich waren (utils/loginLimiter.ts).
```

<a id="indizesundzusammenfassung-3"></a>
## Abschnitt

```text
── idx_parts_category stand hier ───────────────────────────────────────

Der Index lag auf parts(user_id, category_name). Die Kategorie steht seit
Migration 0034 in part_catalog und haengt NICHT am Konto — der fuehrende
user_id waere dort sinnlos.

GEMESSEN, als die Anweisung hier noch stand: „[db] idx_parts_category:
column \"category_name\" does not exist" — geschluckt, also lautlos.

Der Ersatz steht in db/migrations/0034-…, nicht hier, und zwar aus
demselben Grund wie die Indizes aus 0015 (siehe den Block weiter oben):
initSchema() laeuft nur beim allerersten Start. Auf einer LAUFENDEN
Datenbank waere der Index hier nie entstanden, und niemand haette es
gemerkt, weil nichts scheitert.
── Der funktionale Index ist WEG, und das ist eine Einbusse ────────────

Hier stand

    CREATE INDEX idx_parts_group
      ON parts(user_id, (COALESCE(bl_part_number, part_number)), color_id)

auf genau den Ausdruck, nach dem getParts() gruppiert. GEMESSEN an 380
Sets / 171'000 Zeilen halbierte er die Zeit einer Seitenabfrage
(372 ms → 190 ms).

Mit Migration 0037 steht die BrickLink-Nummer in `bl_zuordnung`, und der
Gruppierungsausdruck liest damit eine ANDERE Tabelle. Ein funktionaler
Index kann das nicht: Er darf nur Spalten seiner eigenen Tabelle
enthalten. Dieser Index ist also nicht umgezogen, sondern unmoeglich
geworden — das ist der Preis dafuer, dass die Nummer nur noch an einer
Stelle steht.

Was an seine Stelle tritt:

  * idx_parts_gruppe hier: die EINGÄNGE der Gruppierung
    (user_id, part_number, color_id). Postgres liest die Teilezeilen
    darueber geordnet und haengt die Zuordnung per Hash-Join an;
    bl_zuordnung hat wenige zehntausend Zeilen und passt in den
    Arbeitsspeicher.
  * Vor allem aber: Der HEISSE Weg laeuft gar nicht ueber diese Abfrage.
    Die Teileansicht (exclude_manual=1, ohne Set- und Lagerortfilter)
    liest die vorberechnete Zusammenfassung, und die traegt den
    Gruppenschluessel als fertige Spalte `part_key`
    (utils/partsSummary.ts). Die Live-Abfrage bleibt fuer die Faelle, in
    denen ein Filter die Menge ohnehin klein macht.
Der Ersatzindex steht in Migration 0037 und NICHT hier, aus demselben
Grund wie idx_parts_category (Migration 0034): initSchema() laeuft nur
beim allerersten Start, auf einer laufenden Datenbank waere der Index
hier nie entstanden. Und an zwei Stellen darf er nicht stehen —
scripts/check-schema-am-start.js meldet jede doppelte Definition.

Den alten Index muss niemand loeschen: Er haengt an
parts.bl_part_number, und Postgres entfernt abhaengige Indizes beim
DROP COLUMN selbst.
Vorberechnete Teile-Zusammenfassung inkl. Trigger zur Entwertung.

require() ABSICHTLICH hier unten, nicht oben: utils/partsSummary importiert
(ueber Umwege) auf db/database zurueck. Ein Top-Level-Import schloesse den
Ladezyklus, und dann waere eines der beiden Module beim Laden des anderen
noch halb leer — ein Fehler, der sich erst zur Laufzeit und nur manchmal
zeigt. Nachgeprueft mit einer Zyklus-Analyse ueber alle Top-Level-Importe
des Baums; im ganzen Projekt sind es 5 solche Stellen.
```

<a id="initschemaonce-appversion"></a>
## `appVersion`

```text
Fassung dieses Deployments. Der postinstall-Hook (scripts/bump-version.js)
setzt sie bei jeder Installation neu — sie ändert sich also genau dann,
wenn auch neue Migrationen dazugekommen sein können.

GEMESSEN: Hier stand `require('../package.json')`. Aus dist/db/database.js
loest Node das nach dist/package.json auf — eine Datei, die es nicht gibt.
appVersion war damit IMMER 'unknown'.

Dieselbe Falle ist in utils/appPaths.ts bereits beschrieben und geloest
(„dist/server.js sieht als __dirname das Verzeichnis dist/"): APP_ROOT geht
nach oben, bis eine package.json auftaucht, und stimmt aus den Quellen wie
aus dem Bau. Von dort wird sie jetzt gelesen.
```

<a id="initschemaonce-client"></a>
## `client`

```text
Blockierender Advisory-Lock auf einer DEDIZIERTEN Verbindung: So führt im
Cluster immer nur EIN Worker die Schema-Migration gleichzeitig aus. Andere
Worker warten hier, bis der Lock frei ist, und rufen initSchema danach als
No-op auf (CREATE TABLE/INDEX IF NOT EXISTS finden alles vor).

Wichtig: Lock und Unlock MÜSSEN auf derselben Session laufen — über den Pool
(pool.query) landet der Unlock sonst evtl. auf einer anderen Verbindung und
greift nicht. Ausserdem ist "CREATE TABLE IF NOT EXISTS" unter Nebenläufig-
keit NICHT sicher (zwei Worker → duplicate key in pg_type), was genau diese
Serialisierung verhindert. Stürzt der Lock-Halter ab, wird die Session (und
damit der Lock) automatisch freigegeben, sodass kein Worker dauerhaft hängt.
```

<a id="initschemaonce"></a>
## Abschnitt

```text
── initSchema() ist der ERSTSTART, nicht der Weg fuer Aenderungen ──────

Hier stand ein Vergleich mit der Fassung dieses Deployments, und darueber
der Satz „Nach einem Update aendert sich die Version und die Migration
laeuft genau einmal erneut". Beides war unwahr und das zweite waere
gefaehrlich:

 1. UNWAHR: appVersion war immer 'unknown' (siehe oben), der Vergleich
    also immer erfuellt. initSchema() lief seit Einfuehrung des Vermerks
    auf jeder bestehenden Datenbank NIE wieder — unabhaengig von Updates.
 2. GEFAEHRLICH, waere es wahr gewesen: initSchema() macht nicht nur
    Schema. Nachgezaehlt enthaelt es ein Dutzend datenverändernder
    Anweisungen, in drei Sorten:

      • `CREATE … IF NOT EXISTS` — beliebig oft wiederholbar.
      • Nachtraege mit `NOT EXISTS`-Riegel (Erst-Erfassungen fuer
        manuelle Teile, Minifiguren, Sets). Wiederholbar, ABER: Sie legen
        eine Zeile wieder an, die jemand bewusst geloescht hat.
      • `UPDATE users SET is_active=1, email_verified=1 WHERE is_admin=1`
        — ohne jeden Riegel. Bei jedem Deployment haette das ein
        abgeschaltetes Administratorkonto stillschweigend wieder
        freigeschaltet. (Diese eine Anweisung ist jetzt auf NULL-Werte
        eingeschraenkt, also auf das, wofuer sie gedacht war: Spalten, die
        es gerade erst gibt.)

Der Zustand, der hier aus Versehen entstand, ist also der RICHTIGE. Er
steht jetzt ausdruecklich da: initSchema() laeuft, wenn diese Datenbank
noch keinen Schemastand vermerkt hat — das heisst beim allerersten Start.
Jede Aenderung danach gehoert in eine Migration (db/migrate.ts), und das
stand ohnehin schon weiter unten.

appVersion wird weiter vermerkt, steuert aber NICHTS mehr: Sie ist eine
Auskunft fuer die Fehlersuche („welcher Stand hat dieses Schema
angelegt?"). Genau deshalb durfte sie repariert werden, ohne das
Verhalten zu bewegen.

FORCE_SCHEMA_INIT=1 ist der Notausgang von Hand. Er tut jetzt mehr als
vorher — naemlich ueberhaupt etwas — und deshalb warnt er.
```

<a id="initschemaonce-2"></a>
## Abschnitt

```text
── Nur vermerken, wenn NICHTS geschluckt wurde ────────────────────

Die Begruendung steht bei schlucke(). Kurz: Hier wurde die Fassung
bedingungslos vermerkt, und damit wurde ein einmaliger Fehlschlag zu
einem dauerhaften Zustand — initSchema() laeuft ja nur EINMAL, beim
Erststart. Der fehlende Vermerk ist damit der einzige Weg, auf dem ein
unvollstaendig angelegtes Schema beim naechsten Start noch eine zweite
Gelegenheit bekommt.

Der Server startet trotzdem. Ein fehlender Index oder eine fehlende
Spalte macht einzelne Ansichten langsamer oder leer; ein Server, der
gar nicht hochkommt, macht alles leer. Aber der naechste Start
versucht es wieder, und bis dahin steht im Protokoll, was fehlt.
```

<a id="applied"></a>
## `applied`

```text
Nummerierte Migrationen — laufen IMMER, auch wenn initSchema()
übersprungen wurde.

Der Vermerk in schema_meta beantwortet nur "hat diese Datenbank je einen
Schemastand angelegt bekommen?". Neue Migrationen müssen davon unabhängig
geprüft werden: Sie haben ihre eigene Buchführung in schema_migrations und
sind die Stelle, an der jede Schemaänderung landet (siehe db/migrate.ts).
Läuft auf derselben Verbindung wie der Advisory-Lock, also im Cluster
serialisiert.
```

<a id="eigeneverbindung"></a>
## `eigeneVerbindung`

```text
Eine EIGENE Verbindung, die NICHT aus dem Pool kommt.

── Wofür (Nachtrag 115) ────────────────────────────────────────────────────
Für Sitzungssperren, die über eine lange Arbeit gehalten werden müssen —
etwa während eine Vorschau berechnet wird.

Aus dem Pool wäre das falsch: Der Pool ist auf 10–15 Verbindungen je
Arbeitsprozess ausgelegt und dafür da, ANFRAGEN zu bedienen. Wer eine davon
über Sekunden festhält, nimmt sie genau dort weg. Auf dem Primärprozess
halten Preis-Job, Anleitungs-Warteschlange und Teile-Anreicherung ohnehin
schon je eine — und dieser Prozess bedient nebenbei auch noch Anfragen.

Genau daran ist es aufgelaufen: `timeout exceeded when trying to connect`
in getSets, während die Bildarbeit lief.
```
