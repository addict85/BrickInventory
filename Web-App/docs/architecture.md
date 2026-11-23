# Architektur der Web-App

Kurzüberblick. Die Regeln selbst prüft `test/layers.test.js`; dieses Dokument
sagt, wo was hingehört. Ändert sich die Rangfolge dort, ändert sie sich hier
(der Test vergleicht beide). Jeder Name und Pfad in Backticks muss im Code
vorkommen bzw. existieren; das prüft `test/layers.test.js` ebenfalls
(„docs/architecture.md names only what exists“).

## Prozesse

| Rolle (`ROLE`) | Aufgabe |
|---|---|
| `web` | HTTP: Oberfläche (`public/`), API unter `/api/v1`, Bild-Proxy, `/metrics` |
| `jobs` | Hintergrundarbeit aus der Auftragstabelle (`jobs`), Zeitpläne |
| `beides` | beides in einem Prozess (Entwicklung, kleine Installationen) |

Beide Rollen migrieren beim Start; `initSchemaOnce` lässt genau einen
arbeiten. Prozesse sprechen über PostgreSQL miteinander (Tabellen,
`LISTEN/NOTIFY` über `db/pgNotify.ts`), nicht über Speicher.

**Mehrere Web-Prozesse** auf einer Datenbank laufen gleichzeitig richtig
(Migration 0135, `test/web-two-instances-db.test.js`). Was über Prozesse hinweg
gelten muss, steht in der Datenbank: das Anfragebudget je Konto (`api_budget`,
`src/http/apiThrottle.ts`), die PDF-Tickets (`pdf_tickets`,
`src/vouchers/pdfTicket.ts`), Anmelde- und Gutscheinbremsen
(`rate_limit_attempts`), Idempotenz. Zwischenspeicher (Token, Sitzungsversion,
Haushalt, globale Einstellungen) leert jeder Prozess, sobald ein anderer per
`NOTIFY` eine Änderung meldet; ohne stehende Hörverbindung gilt nur die
Datenbank. Bewusst je Prozess bleibt, was den Prozess selbst schützt oder ihm
gehört: Kontoschranke (`src/http/accountLimit.ts`), CSP-Berichtsdrossel,
offene Ströme, Konfiguration, Metriken. Jeder solche Zustand nennt seinen Grund
in `REASONS` (`src/infra/processWide.ts`).

## Schichten

```
server.ts               startet nur: Konfiguration, Datenbank, Jobs, Metriken, Herunterfahren
startup/                baut ein (app.ts: Express-App mit buildApp, wiring.ts: buildServices)
routes/                 HTTP: Eingabe prüfen (Vertrag), Dienst rufen, antworten
jobs/                   Auftrags-Worker, Bearbeitertabelle, Verdrahtung (keine Fachlogik)
src/<bereich>/          Dienste (Fachlogik) und repository (SQL)
db/, clients/           Datenbank und Aussenwelt (nur HTTP)
src/http/               HTTP-Helfer für Routen und HTTP-Seiten (Fehlerantwort, Upload, Drossel, Metriken)
src/contract/           der API-Vertrag (zod-Schemas, Prüfung, OpenAPI), von allen Bereichen geteilt
src/infra/              fachfreie Helfer
```

`src/infra` ist die unterste Stufe: Es importiert keinen anderen Bereich (das
prüft die Rangfolge unten). „Fachfrei“ ist es nicht durchgehend, und das ist
Absicht, solange es nur von unten gebraucht wird:

- Reine Helfer ohne Bezug zu HTTP: Fehler (`src/infra/error.ts`,
  `src/infra/errorTexts.ts`), Konfiguration (`src/infra/config.ts`),
  Geheimnisse, Protokoll (`src/infra/log.ts`), Metriken
  (`src/infra/metrics.ts`), Abruf nach draussen (`src/infra/fetch.ts`,
  `src/infra/foreignAddresses.ts`), CSV, Validierung.
- Kleine Fachregeln, die mehrere Bereiche teilen und deshalb nicht in einem
  von ihnen liegen können: Setnummern (`src/infra/setNumber.ts`), Geld
  (`src/infra/money.ts`), Passwortregel (`src/infra/passwordRule.ts`).
- Die Regel, welchen Proxys man traut (`src/infra/proxyTrust.ts`). Express
  importiert `src/infra` nicht; die HTTP-Hülle (`sendError` in
  `src/http/httpResponse.ts`, Datei-Ein- und -Ausgang, Schranken je Konto,
  Sitzungskeks) liegt eine Stufe höher in `src/http`, der Vertrag in
  `src/contract` (Stufe 2). Dienste kennen Express nicht; was sie von der
  Anfrage brauchen, trägt der Aufrufrahmen (`src/infra/accountContext.ts`,
  siehe unten).
- Den Zugang kennt `src/infra` nur als Schnittstelle (`Access` in
  `src/infra/access.ts`); `db/database.ts` erfüllt sie.

- Jeder Fachbereich hat eine `index.ts`; andere Bereiche, Routen, Jobs und
  `startup/` importieren nur darüber (ausser den HTTP-Seiten unter
  `src/<bereich>/http/`). So bleibt der Schnitt der Dateien Sache des Bereichs.
  Sie gibt nur Typen, die Fabrik (`createX`, etwa `createVouchers`) und reine
  Funktionen her; was Datenbank, Netz oder Dateien braucht, ruft ein anderer
  Bereich über den Kontext (`k.catalog.…`, in einer Transaktion `t.catalog.…`).
- SQL steht nur in `src/<bereich>/repository*` und `db/`, auch als Klausel
  (Sortierung, Bedingung, Upsert). Dienste nehmen aus `db/database.ts` nur Typen
  und den Betrieb (Pool, eigene Verbindung).
- `jobs/` führt Aufträge aus: Pacht, Wiederholung und Abbruch im Worker
  (`jobs/jobWorker.ts`), je Art ein Aufruf in der Bearbeitertabelle. Was ein
  Auftrag tut, steht in `src/<bereich>/` (Preislauf in `src/finances`,
  Bildbedarf in `src/images` …); die Fehlerarten des Laufs (`JobMove`,
  `JobLost`, `JobInterrupted`) kommen aus `src/jobQueue`.
- Jeder Bereich hat eine Fabrik (`createX` in `area.ts`) und einen Kontext
  (`context.ts`): gebundene Repositories, die Dienste tieferer Bereiche, die
  Konfiguration (`k.konfig`) und die Arbeitseinheit. Ein Dienst nimmt den Kontext
  als ersten Parameter (`k`) und holt alles daraus, nichts vom Prozess. Die Fabrik
  ist eine Closure über `k` (`buildArea`, `src/infra/area.ts`): Jeder Dienst
  steht ausgeschrieben da (`releasePdf: bound(k)(service.releasePdf)`),
  typgeprüft, ohne Namenslisten und ohne Proxy. `startup/wiring.ts` baut alle
  Bereiche in `buildServices(db, components)`; Server und Testhilfe rufen
  dieselbe Funktion.
- Routen sind Fabriken (`buildXRouter(d: Pick<Services, …>)`, Typ aus
  `src/services.ts`) und rufen Dienste nur über `d`; von `startup/` importieren
  sie nichts. Einen Speicher der Dienste im Prozess gibt es nicht: HTTP-Seiten,
  Jobs und Tests bekommen ihre Dienste ebenso gereicht (`buildServices`,
  `testServices()`); `test/ratschen.test.js` verbietet Holer und Fassaden.
- Den Fehlerweg (`errorResponse`) hängt nur `startup/app.ts` an, einmal hinter
  allen Routern; ein Router hängt keinen eigenen an.
- Mehrstufige Schreibvorgänge (Änderung und Protokoll, Zeile und Datei) sind ein
  Dienst mit `k.transact(async t => …)`: Der Rumpf schreibt über `t`, einen
  Kontext an der Verbindung der Transaktion. `t` ist ganz über deren Zugang
  gebaut (`tx.db`): Jeder Satz Dienste tieferer Bereiche entsteht darüber
  (`over(tx.db)`), je Verbindung einmal; der Zugang fragt nur aus dem
  Aufrufpfad der laufenden Transaktion. Das ist die einzige Form: Repositories
  öffnen keine Transaktion, sie nehmen den `tx` des Aufrufers; `.transaction(`
  steht nur in `src/infra/area.ts` und `db/`. Wer ohne Bereich eine Transaktion
  braucht (der Katalogimport in `src/catalog/csvImport.ts`), baut sich mit
  `buildContext` denselben Kontext.
- Den Rahmen (Konto oder Systemrahmen, `inSystemContext`) wählt man vor der
  Transaktion. Ein Wechsel mitten in ihr liefe über den Pool der anderen Rolle,
  also neben ihr; `db/database.ts` wirft dann `BesideTheTransaction`.
- Zustand im Speicher gehört einem Zugang: Ein Bereich hält ihn in seinen Fächern
  (`k.faecher`, `src/infra/cache.ts`). Bewusst prozessweiter Zustand steht mit
  Grund in `REASONS` (`src/infra/processWide.ts`); modulweite `let` und leer
  angelegte `Map`/`Set` zählt `test/ratschen.test.js`.
- Routen importieren nichts aus `db/`, `jobs/` oder `clients/`. Sie umhüllen
  nichts mit `try/catch`; der Fehlerweg des Routers antwortet. Ein `.catch(…)`
  gibt es nur dort, wo die Antwort einen Ersatzwert braucht (etwa der Token
  beim Anmelden in `routes/auth.ts`: ohne Token ein eigener Fehlercode).
- Express kennen nur die Routen, `server.ts`, `startup/`, `src/http`
  (Fehlerweg, Herkunft, Dateiauslieferung, Vertragsrouter, Metriken) und die
  HTTP-Seiten der Bereiche unter `src/<bereich>/http/` (Anmeldung und Sitzung in
  `src/account`, Startseite in `src/profile`, Bild-Proxy in `src/images`,
  Idempotenz-Middleware). Fachdienste importieren weder Express noch eine
  HTTP-Seite; eine Absage ist eine `ErrorKind` (oder ein `DomainError`), den
  HTTP-Status wählt `src/http/errorKind.ts`.
- Clients erreicht man nur über `src/externalSources/sources.ts`. Jeder Klient
  entsteht dort je Satz Dienste (`createRebrickable(z)` …) mit Schlüssel,
  Kontingent und Drossel seines Zugangs (`clients/access.ts`); einen Zugang des
  Prozesses gibt es nicht. Tests stellen Klienten mit `testSources()` oder
  lassen die echten gegen einen lokalen HTTPS-Stub laufen
  (`test/helpers/https-stub.js`).
- Den Rumpf `k.transact(async t => …)` prüft vorher die Lint-Regel
  `biome/transaction-body.grit`: kein `k`, `sk`, `kx` oder Empfänger darin.
- Fragt mitten in einer Transaktion jemand über den ungebundenen Zugang (`k`
  statt `t`), wirft die Datenbankschicht `UnboundQuery`: Sie liefe sonst über
  eine zweite Verbindung neben der Transaktion. Erkannt wird das am
  Aufrufrahmen; ein Weg in die Transaktion ist er nicht.
- Die Zeit kommt über `k.uhr` (`src/infra/clock.ts`, `buildServices(db, { uhr })`),
  nicht über `Date.now()`: Tests stellen sie (`testClock().vor(ms)`), statt eine
  Frist abzuwarten. Drosseln mit echten Zeitgebern bleiben bei der Systemzeit;
  den Rest zählt `test/ratschen.test.js`.
- `konfig()` liest nur der Start (`startup/`, `server.ts`); Fachbereiche, Routen
  und Jobs bekommen die Konfiguration gereicht (`buildServices` → `k.konfig`,
  sonst als Parameter). Übrig sind Helfer des Prozesses in `src/infra`,
  `src/http`, `db/` und der beim Laden gebaute bcrypt-Pool; ihre Zahl hält
  `test/ratschen.test.js`.

## Aufrufrahmen: wer fragt

„Wer fragt“ steht an einer Stelle: im Aufrufrahmen
(`src/infra/accountContext.ts`), dem einzigen Kanal über `AsyncLocalStorage`
(`test/ratschen.test.js` verbietet weitere). Die Anfrage setzt ihn einmal
(`rememberRequest`, aus Sitzung oder Token), ein Auftrag ebenso
(`inNamesOfJob`), Arbeit über Konten betritt ausdrücklich den Systemrahmen
(`inSystemContext`). Die Datenbankschicht setzt daraus je Transaktion
`app.account` für den Zeilenschutz.

Warum dieser eine Kanal bleibt: Das Konto des Zeilenschutzes gehört zur
Verbindung, nicht zu einem Dienst. Es ausdrücklich durch jeden Dienst bis zu
jeder Abfrage zu reichen, hiesse jede Signatur und jedes Repository zu ändern,
ohne dass eine Abfrage dadurch richtiger würde. Er trägt daneben nur, was ebenso
den Aufrufpfad betrifft und nichts übergibt: den Merker der offenen Transaktion
für die Wachen (`UnboundQuery`, `BesideTheTransaction`, kein Ersatzwert in einer
Transaktion), den Commit-Begleiter der Idempotenz (`withCommitCompanion`) und die
Kennung der Anfrage fürs Protokoll (`requestContext`). Die Transaktion selbst
reist über `t`.

Dienste bekommen den Anfragenden weiter als `uid` (oder in einer `Sicht`). Damit
es trotzdem nur eine Quelle gibt, prüft der Haushalt, der „wer fragt“ auslegt
(`householdOf`, `writeScope`, `mayWriteFor`, `seesAccount`), dass dieses Konto
das des Rahmens ist (`checkRequester`). Ein anderes wirft `ForeignAccount`, statt
still nur zu sehen, was der Zeilenschutz des Anfragenden zeigt; im Systemrahmen
gilt jedes Konto. Wer für ein anderes Konto arbeitet, sagt es am Aufruf
(`asRequest`, `inSystemContext`).

## Fehler

Eine Regel je Weg, damit ein Fehler nie wie ein Ergebnis aussieht:

- **Ein Fehlerweg.** Eine Absage ist ein `DomainError` mit `ErrorKind`
  (`failDomain()`, für einen Lesepfad ohne Treffer `notFound()`); den Status
  wählt nur `src/http/errorKind.ts`, die Antwort schreibt nur `errorResponse`
  (über `handleRouteError`). Felder neben `code` und `error` (etwa `wartenSek`)
  trägt der Fehler als `extra`; jede Fehlerantwort nennt dazu die Kennung der
  Anfrage (`request_id`, gleich dem Kopf `X-Request-Id`). Dienste geben keine
  Absage als Ergebnis zurück (`{ fehler }`, `{ ok: false }`), Routen rufen kein
  `sendError` (`test/layers.test.js`; die eine Ausnahme ist die Uhr in
  `bodyDeadline`, die nach `next()` läuft). Alles andere fliegt weiter bis zum
  Fehlerweg der App oder des Auftrags.
- **Lesepfade** mit Teilen, die ausfallen dürfen, nehmen `attempts()` oder
  `Degradations` (`src/infra/result.ts`): Die Antwort nennt sie in `degradiert`.
- **`logAndContinue`** nur für Nebenwirkungen ohne Folgen für das Ergebnis: Mail
  und Signal nebenher, Fortschritt und Stand, Aufräumen nach dem eigentlichen
  Fehler, Herunterfahren. Einen Ersatzwert liefert `reportAndDeliver` und nennt
  sein Warum im Code. `test/ratschen.test.js` zählt beide, dazu jeden Fang in
  `src/`, der nur meldet und weiterläuft (`catch (e) { reportError(…) }`, auch
  mit `return x` danach): Er ist ein Ersatzwert ohne Namen. Wer dort direkt in
  die Konsole schreibt, nennt sein Warum als „Exception:“. Die Oberfläche hat
  eine eigene Ratsche für Fänge ohne Meldung (`public/js`).
- Ein Signal ist eine **Fehlerklasse** (`StreamClosed`, `JobLost` …), keine
  Zeichenkette, die der Fänger vergleicht.
- Der Transaktionswächter (kein Ersatzwert in einer laufenden Transaktion) ist
  die Transaktion selbst: Ihr Stand (`newTxStatus`, `db/transaction.ts`) reist im
  Aufrufrahmen, kein Zustand des Prozesses.

## Beobachtbarkeit

- **Protokoll** (`src/infra/log.ts`): Jede `console`-Zeile wird eine JSON-Zeile
  auf stdout/stderr (`jsonRow`) und landet gepuffert in `app_logs`. Die Kennung
  der Anfrage (`rid`) setzt `startup/app.ts` als erste Middleware aus
  `X-Request-Id` (nur harmlose Zeichen, sonst eine eigene, `requestId`). Ein
  Zeilenumbruch in einer Meldung wird an einer Stelle (`oneLine`) zu `⏎`; die
  Aufrufer maskieren nicht selbst. Platzhalter (`%s`, `%d`) füllt das Protokoll
  wie die Konsole.
- **Metriken** (`src/infra/metrics.ts`): Zähler, Messwerte und Histogramme des
  Prozesses im Prometheus-Textformat. HTTP zählt `src/http/metrics.ts` je
  Routenmuster (aus dem Vertrag, `keyForRequest`) und Status, nie je rohem Pfad;
  Abrufe nach draussen zählt `src/infra/fetch.ts` je Host der eigenen Liste und
  Ergebnis; Auftragsläufe `jobs/jobWorker.ts`; Pools und Warteschlange liest
  `startup/metrics.ts` unmittelbar vor jeder Abfrage (`registerCollectors`).
  `/metrics` antwortet nur mit `METRICS_TOKEN` oder, ohne Token, einem Aufruf
  vom selben Rechner ohne Proxy; Caddy gibt den Pfad nicht nach aussen. Der
  reine Job-Prozess öffnet dafür `METRICS_PORT` (`startMetricsServer`).

## Zeilenschutz: was er leistet und was nicht

Der Zeilenschutz (Migrationen 0111, 0112) fängt einen **vergessenen Filter** auf
`user_id`: In den Tabellen mit Kontodaten (Bestand, Käufe, Merkliste,
Einstellungen je Konto, Zugangsdaten wie `api_tokens`, `passkeys`,
`second_factor`, Aufträge, Budget und Tickets) sieht und ändert die Laufzeitrolle
nur Zeilen von `app.account` und dessen direkten Unterkonten, ohne Konto keine.
Zugangsdaten (Passkeys, zweiter Faktor, Tokens, Geräteschlüssel,
Schrittfreigaben) sieht nur das Konto selbst, kein Hauptkonto (Migration 0114).
Die Datenbankschicht setzt `app.account` je Transaktion (`set_config(…, true)`)
aus dem Konto der Anfrage. Den Systemrahmen trägt die Systemrolle
(`BYPASSRLS`), keine Einstellung.

Er ist **keine Grenze gegen eingeschleustes SQL**:

- `app.account` ist eine Sitzungseinstellung. `set_config('app.account', …)` darf
  jede Rolle aufrufen; wer SQL über die Laufzeitrolle ausführen kann, setzt sich
  jedes Konto und sieht dessen Zeilen. Dagegen schützen nur Parameter statt
  zusammengesetzter Abfragen.
- Der Haushalt (Migration 0115): `account_links` liest jedes Konto, anlegen darf
  nur der Systemrahmen, lösen nur ein beteiligtes Konto; `account_link_invites`
  und `household_former_links` sieht nur ein beteiligtes Konto.
- Ohne Zeilenschutz sind `users`, `admin_log`, `rate_limit_attempts`,
  `global_settings`, Kataloge, Preis- und Bildzwischenspeicher, Laufzustände.
  Hier schützt der Filter im Repository, bei den ersten dreien zusätzlich das
  Recht der Rolle (unten).
- Die Systemrolle sieht alles. Was im Systemrahmen läuft (Anmeldung vor dem
  Konto, Aufträge, Verwaltung über Konten, Haushaltswährung), prüft die
  Berechtigung selbst.
- Die Laufzeitrolle hat `SELECT, INSERT, UPDATE, DELETE` auf alle Tabellen
  (`postgres/app-role.sh`) mit diesen Ausnahmen: `users.password_hash` liest sie
  nicht, `user_sessions` gar nicht; in `users` schreibt sie nur `first_name` und
  `last_name`, `global_settings` liest sie nur (Migration 0117). Anmeldung,
  Sitzungsspeicher, Passwort, Rechte, Adresse, Sitzungsversion und globale
  Einstellungen laufen über die Systemrolle (`imSystem(…)` im Kontext des
  Bereichs). `admin_log` ist für beide Rollen nur anfügbar; aufgeräumt wird über
  `admin_log_cleanup()` (feste Frist, Eigentümerin).
- Gutscheine, Idempotenzeinträge, Budget und PDF-Tickets sieht wie die
  Zugangsdaten nur das eigene Konto (Migrationen 0118, 0135). Kopien vor
  Migrationen (`vor_migration_*`) haben RLS ohne Policy und sind damit nur für
  die Systemrolle und die Eigentümerin lesbar.

## Rangfolge der Bereiche

Ein Bereich importiert nur Bereiche tieferer Stufen, auch mit `import type`;
Bereiche derselben Stufe kennen einander nicht. Die Kanten löst der Übersetzer
auf (`tsc --explainFiles`). Von unten nach oben:

| Stufe | Bereiche |
|---|---|
| 1 | `src/infra` |
| 2 | `src/contract` |
| 3 | `src/http` |
| 4 | `db`, `clients` |
| 5 | `src/throttle` |
| 6 | `src/settings` |
| 7 | `src/mail` |
| 8 | `src/jobQueue` |
| 9 | `src/externalSources` |
| 10 | `src/household`, `src/devices`, `src/factors` |
| 11 | `src/account` |
| 12 | `src/images`, `src/profile` |
| 13 | `src/idempotency`, `src/catalog` |
| 14 | `src/finances` |
| 15 | `src/inventory` |
| 16 | `src/sets` |
| 17 | `src/parts`, `src/minifigs`, `src/wanted`, `src/vouchers` |
| 18 | `src/collection`, `src/management` |
| 19 | `src/services.ts` |
| 20 | `jobs`, `routes` |
| 21 | `startup` |
| 22 | `server.ts` |

## Schema

Die Wahrheit sind die Migrationen in `db/migrations/`. Daraus erzeugen
`npm run schema:snapshot` und `npm run schema:rows` drei Dateien, alle geprüft:

| Datei | Wozu | Prüfung |
|---|---|---|
| `db/base.sql` | Erststart: eine leere Datenbank bekommt dieses Abbild der ersten N Migrationen, danach laufen nur die jüngeren | `test/schema-base-db.test.js`: lückenlose Folge vorhandener Migrationen; mit gleichem pg_dump erzeugt das Abbild sich selbst |
| `db/schema-snapshot.sql` | Lesefassung des Schemas nach allen Migrationen, für Reviews | `test/schema-fresh-db.test.js`: gleich dem Schema einer frisch gestarteten Datenbank |
| `db/rows.ts` | Zeilentypen je Tabelle (`npm run schema:rows`): Repositories binden ihre Zeilen daran (`Columns<'price_cache', 'avg_price'>`) | `test/rows-types-db.test.js`: Spalten und NULL wie in der Datenbank, jeder Typ kommt so an |

Von Hand geändert wird keine davon; eine Schemaänderung ist immer eine
neue Migration. `db/base.sql` wird nur neu erzeugt, wenn die Basis bewusst
vorrückt (`npm run schema:snapshot` schreibt beide; sonst `db/base.sql` verwerfen).

## Tabellen und Besitzer

Jede Tabelle hat genau einen Besitzer: Nur sein Bereich schreibt hinein (INSERT,
UPDATE, DELETE). Andere Bereiche rufen dessen Dienst, in einer Transaktion über den
Kontext `t`. Fremde Bereiche lesen über Lesebausteine in `db/`
(`db/catalogView.ts`, `db/householdView.ts`, `db/accessView.ts`,
`db/inventoryView.ts`, `db/accountView.ts`, `db/stockQuantity.ts`) oder über den
Dienst des Besitzers. Ein Lesebaustein ist keine eigene Stufe: Sein SQL zählt beim
Bereich, der ihn einbindet. Die Stufen gelten deshalb auch für Daten:

- Liegt der Leser über dem Besitzer, importiert er den Baustein.
- Liegt er darunter (Einstellungen, Aufträge, Haushalt, Geräte, Bilder, Katalog,
  Finanzen, Bestand), nennt er in `src/<bereich>/readContract.ts` die Form, die er
  braucht (Unterabfragen mit festen Spalten), und bekommt sie als `lesevertrag` im
  Kontext. Gefüllt wird der Vertrag aus `READ_CONTRACT` in `src/services.ts`
  (Stufe 19, über jedem Besitzer); die Repositories nehmen ihn nach dem Zugang
  (`withContract`). Wer eine Tabelle umbaut, passt den Baustein an, der Vertrag
  des Lesers bleibt.
- Die Kontobedingung eines Bausteins ist nur ein Platzhalter (`db/accounts.ts`:
  `= $n` oder `= ANY($n)`).

`test/shared-tables-db.test.js` teilt die Lesestellen ein: Aufwärts gibt es keine,
weder direkt noch über `db/` (was ein Baustein liest, zeigt sein Ergebnis); Lesen
des Katalogs und direkt abwärts zählen je eine Ratsche, die nur sinken darf. Ein
Trigger schreibt nur in Tabellen seines Besitzers; die Ausnahmen (Teilezähler,
Vormerkung für die Teile-Zusammenfassung) stehen begründet in
`TRIGGER_FREMDZIELE` desselben Tests. Einzige schreibende Ausnahme: Der
Schemastart (`db/schemaStart.ts`) setzt die Zeitzone in `global_settings`, bevor
es Dienste gibt. Die Tabelle hier ist die Quelle für den Test.

Die Bestandszeilen eines Kontos (Sets, Teile, Figuren, ihre Käufe, Orte,
Papierkorb) gehören `src/inventory`: Papierkorb, Lagerorte und Tageserfassung
arbeiten über alle drei Arten, und nur der tiefste Bereich, der sie schreibt, kann
von den anderen gerufen werden. Sets, Teile und Figuren schreiben über
`t.inventory`. Wählt eine Datei den Tabellennamen zur Laufzeit, misst der Test,
was sie liest und schreibt (`DYNAMISCH`); dafür gelten dieselben Regeln.

| Besitzer | Tabellen |
|---|---|
| `db` | `schema_migrations` |
| `src/infra` | `app_logs` |
| `src/throttle` | `rate_limit_attempts`, `api_budget` |
| `src/settings` | `global_settings`, `user_settings` |
| `src/jobQueue` | `jobs`, `job_exclusive_locks`, `job_pauses`, `job_types`, `import_status`, `run_state` |
| `src/externalSources` | `api_calls`, `api_cadence` |
| `src/household` | `account_link_invites`, `account_links`, `household_former_links` |
| `src/devices` | `device_nonces`, `device_keys`, `step_up_challenges`, `step_up_approvals` |
| `src/factors` | `passkeys`, `webauthn_challenges`, `second_factor`, `second_factor_codes` |
| `src/account` | `api_tokens`, `api_tokens_consumed`, `qr_login_tokens`, `user_sessions`, `users`, `admin_takeovers`, `admin_log` |
| `src/images` | `image_misses`, `image_wanted` |
| `src/idempotency` | `idempotency` |
| `src/catalog` | `bl_mapping`, `bl_mapping_custom`, `catalog_cache`, `minifig_custom`, `minifig_parts_cache`, `minifigs_catalog`, `part_catalog`, `part_color_catalog`, `rb_colors`, `rb_inventories`, `rb_inventory_minifigs`, `rb_inventory_parts`, `rb_part_categories`, `rb_parts`, `rb_sets`, `rb_themes`, `set_catalog`, `set_minifigs`, `set_parts`, `shared_instructions`, `subsets_cache`, `part_custom`, `part_color_custom` |
| `src/finances` | `minifig_price_cache`, `minifig_price_history`, `part_price_cache`, `part_price_history`, `price_alerts`, `price_cache`, `price_history`, `exchange_rates` |
| `src/inventory` | `minifig_acquisitions`, `minifigs`, `trash`, `part_acquisitions`, `parts`, `set_acquisitions`, `sets`, `storage_locations` |
| `src/sets` | `instructions` |
| `src/parts` | `parts_catalog_pending`, `parts_summary`, `parts_summary_state`, `parts_version_user` |
| `src/wanted` | `wanted` |
| `src/vouchers` | `voucher_balance_throttle`, `vouchers`, `pdf_tickets` |

## API-Vertrag

`src/contract/` beschreibt jede Route mit zod: Antwort und, für jede
schreibende Route, die Eingabe. Daraus entstehen die Routentypen (tsc),
`docs/openapi.json` (`npm run contract:openapi`), die Typen der Oberfläche
(`frontend-types/contract.d.ts`) und die Kotlin-Antworttypen der App (aus `docs/openapi-v2.json`). Der
Vertrag ist die einzige Eingabeprüfung und liefert das Fachformat: Was eine
Route liest, hat der Vertrag schon umgeformt (`z.transform`); eine Route wandelt
ihre geprüfte Eingabe nicht nach (`test/layers.test.js`).

Was die App vom Server braucht (Routen, Abfrage, Rumpffelder, die Felder ihrer
Modelle), steht in `shared/app-interface.json`. Der Android-Lauf erzeugt und
prüft die Datei aus dem Kotlin-Quelltext (`Android-App/tools/contract/`), die
Web-Suite prüft den Server gegen sie (`test/app-interface.test.js`,
`test/contract-read-db.test.js`, `test/contract-write-db.test.js`).
Kotlin-Quelltext liest die Web-Suite nicht (`test/ratschen.test.js`).

Eine Route registriert sich über ihren Schlüssel:
`router.endpoint('GET /api/v1/sets/:setNumber', requireToken, async req => …)`.
Methode, Pfad und die Typen von `req`/`res` kommen aus ihm; der Router kennt sein
Präfix (`contractRouter('/api/v1')`), ein Schlüssel ausserhalb kompiliert nicht,
und unter fremdem Präfix eingehängt antwortet er 500. Die Route gibt ihr Ergebnis
zurück, der Router setzt `{ success: true, … }` davor (die App liest `success`);
eine Route, deren Vertrag kein `success` nennt, antwortet selbst. Die Typprobe
steht in `test/types/contractRouter.typprobe.ts`.

### Namen

Pfade und Feldnamen der API sind Vertrag: App und Webapp hängen daran. Unter
`/api/v2` sind Pfade, Felder, Werte und Fehlercodes englisch; `/api/v1` ist bis
zum 30.06.2027 ein Alias mit den früheren, teils deutschen Namen
(`src/contract/v1Names.ts`, `src/contract/v1Routes.ts`, `src/http/apiV1Alias.ts`).
Neue Routen und Felder folgen der Mehrheit: Pfade englisch im Plural mit
Bindestrich, Pfadparameter `:setNumber`, `:partNumber`, `:figNumber`, `:id`;
Felder `snake_case`. Verbliebene Abweichungen unter v2 (Stand 22.11.2026):

| Art | Beispiele |
|---|---|
| gleiche Sache, zwei Namen | `currency`/`currency_code`; „Job“ für die Hintergrundarbeit (`/admin/jobs`, `/admin/job-status` neben `/admin/job-queue`) |
| Parameter | `:sn` (`/sets/:sn/move`) statt `:setNumber`; Abkürzungen `:acqId`, `:instrId`, `:tokenId`, `:jobId` |
| Schreibweise | `camelCase` in einigen Antworten (`isAdmin`, `mustChangePassword`, `jobId`, `etaSeconds`) |
| Form | `/sets/:setNumber/alert` neben `/alerts`; `parts-list`, `minifigs-list`, aber `partslist-pdf`; `/wanted-list/import/xml` neben `/wanted/import/csv`; `/finance/pnl` |

Innen (Bezeichner, Kommentare, Dateinamen, Schema) ist der Code seit Runde 30
englisch (CLAUDE.md). Eine Regel hat einen Namen: Setnummern normalisiert nur
`normalizeSetNumber` (`src/infra/setNumber.ts`), Sets verschiebt `moveSet`;
Bild- und Quellenhelfer importiert man aus `src/images` bzw.
`src/externalSources`, nicht über `src/catalog`.

## Begründungen

Im Code steht das Warum in wenigen Zeilen; lange Begründungen und die
Geschichte einer Stelle stehen in der Commit-Nachricht (CLAUDE.md).

## Oberfläche

`public/` ist eine Seite (`index.html`) mit einem Bündel. `npm run build:frontend`
(esbuild, `scripts/build-frontend.js`) macht aus `public/js/main.js` und allem,
was es importiert, `public/js/app.bundle.js` (IIFE, minifiziert; ein Erzeugnis,
nicht in git — `npm run build`, Dockerfile, CI und `npm test` bauen es). Ausserhalb des Bündels laufen nur
`public/js/theme-boot.js` (Design vor dem ersten Bild), die Wörterbücher
`public/locales/de.js` und `public/locales/en.js`, `public/js/pdfjs-boot.js`
und `public/js/logviewer.js`.

Die Dateien tragen sprechende Namen ohne Zahlpräfix. Die Ladereihenfolge steht
explizit in `public/js/main.js` (Importliste), die Schichten in
`scripts/build-frontend.js` (`CORE`, `BUILDING_BLOCKS`); alles übrige ist Ansicht.

| Schicht | Dateien | Regel |
|---|---|---|
| Kern | `CORE` (`state.js`, `events.js`, `escaping.js` …), `public/i18n.js` | kennt keine Ansicht |
| Bausteine | `BUILDING_BLOCKS` (`api.js`, `dom.js`, `format.js` …) | kennt keine Ansicht; `api.js` ist der einzige Weg zum Server |
| Ansichten | alle übrigen Module unter `public/js/` | dürfen Kern und Bausteine importieren |

- **Handler:** Markup nennt Aktionen nur als `data-click`, `data-change` …;
  `public/js/registry.js` ordnet sie den registrierten Funktionen zu (die CSP
  verbietet Inline-Handler).
- **Rückwege ohne Importkreis:** Ansichten melden Ereignisse
  (`public/js/events.js`, `emit`/`subscribe`) statt einander zu importieren.
- **Geteilter Zustand** steht nur in `public/js/state.js` (mit Settern).
- **Markup** entsteht mit dem Tag `html` (`public/js/escaping.js`, maskiert jeden
  Wert) und kommt nur über `setHtml()`/`insertHtml()` (`public/js/dom.js`)
  in die Seite. Inline-Stile heissen `data-style` und werden von
  `public/js/styles.js` gegen eine beim Bauen erzeugte Freigabeliste gesetzt.
- **Texte:** `t()` maskiert eingesetzte Werte für Markup, `tRaw()` nicht (für
  `textContent`); beide aus `public/i18n.js`.
- **Typen:** `tsconfig.frontend.json` prüft die Module streng (JSDoc, `strict`),
  die Routentypen kommen aus `frontend-types/contract.d.ts` (aus dem API-Vertrag erzeugt).

Die Schichten prüft `test/frontend-architektur.test.js`, das Verhalten prüfen
die jsdom-Tests über `test/helpers/ui.js` (echtes `index.html`,
echtes Bündel, Antworten gegen den Vertrag) und die Chrome-Tests über
`test/helpers/app-browser.js`.
