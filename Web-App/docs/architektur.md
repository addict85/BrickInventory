# Architektur der Web-App

Kurzüberblick. Die Regeln selbst prüft `test/schichten.test.js`; dieses
Dokument sagt, wo was hingehört. Ändert sich die Rangfolge dort, ändert sie
sich hier (der Test vergleicht beide).

## Prozesse

| Rolle (`ROLLE`) | Aufgabe |
|---|---|
| `web` | HTTP: Oberfläche (`public/`), API unter `/api/v1`, Bild-Proxy |
| `jobs` | Hintergrundarbeit aus der Auftragstabelle (`jobs`), Zeitpläne |
| `beides` | beides in einem Prozess (Entwicklung, kleine Installationen) |

Beide Rollen migrieren beim Start; `initSchemaOnce` lässt genau einen
arbeiten. Prozesse sprechen über PostgreSQL miteinander (Tabellen,
`LISTEN/NOTIFY`), nicht über Speicher.

## Schichten

```
server.ts               startet nur: Konfiguration, Datenbank, Jobs, Herunterfahren
startup/                baut ein (app.ts: Express-App mit baueApp({ pool, konfig, sitzungsGeheimnis }))
routes/                 HTTP: Eingabe prüfen (Vertrag), Dienst rufen, antworten
jobs/                   Auftrags-Worker, Bearbeitertabelle, Verdrahtung (keine Fachlogik)
src/<bereich>/          Dienste (Fachlogik) und repository (SQL)
db/, clients/           Datenbank und Aussenwelt (nur HTTP)
src/http/               HTTP-Helfer für Routen und HTTP-Seiten (Fehlerantwort, Upload, Drossel)
src/vertrag/            der API-Vertrag (zod-Schemas, Prüfung, OpenAPI), von allen Bereichen geteilt
src/infra/              fachfreie Helfer
```

`src/infra` ist die unterste Stufe: Es importiert keinen anderen Bereich (das
prüft die Rangfolge unten). „Fachfrei" ist es nicht durchgehend, und das ist
Absicht, solange es nur von unten gebraucht wird:

- Reine Helfer ohne Bezug zu HTTP: Fehler (`fehler`, `fehlerTexte`),
  Konfiguration (`konfig`), Geheimnisse, Protokoll, Abruf nach draussen
  (`abruf`, `fremdeAdressen`), CSV, Validierung.
- Kleine Fachregeln, die mehrere Bereiche teilen und deshalb nicht in einem
  von ihnen liegen können: Setnummern (`setNummer`), Geld (`geld`),
  Passwortregel (`passwortRegel`).
- Die Texte der Fehler (`fehlerTexte`) und die Regel, welchen Proxys man traut
  (`proxyVertrauen`). Express importiert `src/infra` nicht; die HTTP-Hülle
  (`sendeFehler` in `httpAntwort`, Datei-Ein- und -Ausgang, Schranken je Konto,
  Sitzungskeks) liegt eine Stufe höher in `src/http`, der Vertrag in `src/vertrag`
  (Stufe 2). Dienste kennen Express nicht; was sie von der Anfrage brauchen,
  trägt der Aufrufrahmen (`kontoKontext`, siehe unten).
- Den Zugang kennt `src/infra` nur als Schnittstelle (`Zugang` in
  `src/infra/zugang.ts`); `db/database.ts` erfüllt sie.

- Jeder Fachbereich hat eine `index.ts`; andere Bereiche, Routen, Jobs und
  `startup/` importieren nur darüber (ausser den HTTP-Seiten unter
  `src/<bereich>/http/`). So bleibt der Schnitt der Dateien Sache des Bereichs.
  Sie gibt nur Typen, die Fabrik (`erzeugeX`) und reine Funktionen her; was
  Datenbank, Netz oder Dateien braucht, ruft ein anderer Bereich über den Kontext
  (`k.katalog.…`, in einer Transaktion `t.katalog.…`). Das prüft `test/schichten.test.js`.

- SQL steht nur in `src/<bereich>/repository*` und `db/`, auch als Klausel
  (Sortierung, Bedingung, Upsert). Dienste nehmen aus `db/database` nur Typen
  und den Betrieb (Pool, eigene Verbindung).
- `jobs/` führt Aufträge aus: Pacht, Wiederholung und Abbruch im Worker, je Art
  ein Aufruf in der Bearbeitertabelle. Was ein Auftrag tut, steht in
  `src/<bereich>/` (Preislauf in `finanzen`, Bildbedarf in `bilder` …); die
  Fehlerarten des Laufs (`AuftragVerschieben` …) kommen aus `src/auftraege`.
- Jeder Bereich hat eine Fabrik (`erzeugeX` in `bereich.ts`) und einen Kontext
  (`kontext.ts`): gebundene Repositories, die Dienste tieferer Bereiche, die
  Konfiguration (`k.konfig`) und die Arbeitseinheit. Ein Dienst nimmt den Kontext
  als ersten Parameter (`k`) und holt alles daraus, nichts vom Prozess. Die Fabrik
  ist eine Closure über `k` (`baueBereich`, `src/infra/bereich.ts`): Jeder Dienst
  steht ausgeschrieben da (`setsLesen: mit(k)(lesen.setsLesen)`), typgeprüft, ohne
  Namenslisten und ohne Proxy. `startup/verdrahtung.ts` baut alle Bereiche in
  `baueDienste(db, bauteile)`; Server und Testhilfe rufen dieselbe Funktion.
- Routen sind Fabriken (`baueXRouter(d: Pick<Dienste, …>)`, Typ aus `src/dienste.ts`) und
  rufen Dienste nur über `d`; von `startup/` importieren sie nichts. Einen Speicher
  der Dienste im Prozess gibt es nicht: HTTP-Seiten, Jobs und Tests bekommen ihre
  Dienste ebenso gereicht (`baueDienste`, `testDienste()`); `test/ratschen.test.js`
  verbietet Holer und Fassaden.
- Den Fehlerweg (`fehlerAntwort`) hängt nur `startup/app.ts` an, einmal hinter allen
  Routern; ein Router hängt keinen eigenen an.
- Mehrstufige Schreibvorgänge (Änderung und Protokoll, Zeile und Datei) sind ein
  Dienst mit `k.transaktion(async t => …)`: Der Rumpf schreibt über `t`, einen
  Kontext an der Verbindung der Transaktion. `t` ist ganz über deren Zugang gebaut
  (`tx.db`): Jeder Satz Dienste tieferer Bereiche entsteht darüber
  (`ueber(tx.db)`), je Verbindung einmal; der Zugang fragt nur aus dem Aufrufpfad
  der laufenden Transaktion. Zustand im Speicher bleibt geteilt. So
  steht am Aufrufort, was zusammen gilt, und nichts leitet eine Abfrage still um.
  Das ist die einzige Form: Repositories öffnen keine Transaktion, sie nehmen den
  `tx` des Aufrufers; `.transaction(` steht nur in `src/infra/bereich.ts` und `db/`.
- Den Rahmen (Konto oder Systemrahmen, `imSystemkontext`) wählt man vor der
  Transaktion. Ein Wechsel mitten in ihr liefe über den Pool der anderen Rolle,
  also neben ihr; `db/database.ts` wirft dann `NebenDerTransaktion`.
- Zustand im Speicher gehört einem Zugang: Ein Bereich hält ihn in seinen Fächern
  (`k.faecher`, `src/infra/zwischenspeicher.ts`). Bewusst prozessweiter Zustand
  (Drosseln, Schranken) steht mit Grund in `src/infra/prozessweit.ts`; modulweite
  `let` und leer angelegte `Map`/`Set` zählt `test/ratschen.test.js`.
- Routen importieren nichts aus `db/`, `jobs/` oder `clients/`. Sie umhüllen
  nichts mit `try/catch`; der Fehlerweg des Routers antwortet. Ein `.catch(…)`
  gibt es nur dort, wo die Antwort einen Ersatzwert braucht (etwa der Token
  beim Anmelden in `routes/auth.ts`: ohne Token ein eigener Fehlercode).
- Express kennen nur die Routen, `server.ts`, `src/http` (Fehlerweg, Herkunft,
  Dateiauslieferung, Vertragsrouter) und die HTTP-Seiten der Bereiche unter
  `src/<bereich>/http/` (Anmeldung und Sitzung in `konto`, Startseite in `profil`, Bild-Proxy in
  `bilder`, Idempotenz-Middleware). Fachdienste importieren weder Express noch
  eine HTTP-Seite; eine Absage ist eine `FehlerArt` (oder ein `Fachfehler`),
  den HTTP-Status wählt `src/http/fehlerArt.ts`.
- Clients erreicht man nur über `src/fremdquellen/quellen.ts`. Jeder Klient
  entsteht dort je Satz Dienste (`erzeugeRebrickable(z)` …) mit Schlüssel,
  Kontingent und Drossel seines Zugangs (`clients/zugang.ts`); einen Zugang des
  Prozesses gibt es nicht. Tests stellen Klienten mit `testQuellen()`.
- Den Rumpf `k.transaktion(async t => …)` prüft vorher die Lint-Regel
  `biome/transaktionsrumpf.grit`: kein `k`, `sk`, `kx` oder Empfänger darin.
- Fragt mitten in einer Transaktion jemand über den ungebundenen Zugang (`k` statt
  `t`), wirft die Datenbankschicht `UngebundeneAbfrage`: Sie liefe sonst über eine
  zweite Verbindung neben der Transaktion. Erkannt wird das am Aufrufrahmen; ein Weg
  in die Transaktion ist er nicht.
- Die Zeit kommt über `k.uhr` (`src/infra/uhr.ts`, `baueDienste(db, { uhr })`), nicht über
  `Date.now()`: Tests stellen sie (`testUhr().vor(ms)`), statt eine Frist abzuwarten. Drosseln
  mit echten Zeitgebern bleiben bei der Systemzeit; den Rest zählt `test/ratschen.test.js`.
- `konfig()` liest nur der Start (`startup/`, `server.ts`); Fachbereiche, Routen und
  Jobs bekommen die Konfiguration gereicht (`baueDienste` → `k.konfig`, sonst als
  Parameter). Übrig sind Helfer des Prozesses in `src/infra`, `src/http`, `db/` und der
  beim Laden gebaute bcrypt-Pool; ihre Zahl hält `test/ratschen.test.js`.

## Aufrufrahmen: wer fragt

„Wer fragt“ steht an einer Stelle: im Aufrufrahmen (`src/infra/kontoKontext.ts`),
dem einzigen Kanal über `AsyncLocalStorage` (`test/ratschen.test.js` verbietet
weitere). Die Anfrage setzt ihn einmal (`merkeAnfrage`, aus Sitzung oder Token), ein
Auftrag ebenso (`imNamenDesAuftrags`), Arbeit über Konten betritt ausdrücklich den
Systemrahmen (`imSystemkontext`). Die Datenbankschicht setzt daraus je Transaktion
`app.konto` für den Zeilenschutz.

Warum dieser eine Kanal bleibt: Das Konto des Zeilenschutzes gehört zur Verbindung,
nicht zu einem Dienst. Es ausdrücklich durch jeden Dienst bis zu jeder Abfrage zu
reichen, hiesse jede Signatur und jedes Repository zu ändern, ohne dass eine Abfrage
dadurch richtiger würde. Er trägt daneben nur, was ebenso den Aufrufpfad betrifft und
nichts übergibt: den Merker der offenen Transaktion für die Wachen (`UngebundeneAbfrage`,
`NebenDerTransaktion`, kein Ersatzwert in einer Transaktion), den Commit-Begleiter der
Idempotenz und die Kennung der Anfrage fürs Protokoll. Die Transaktion selbst reist über `t`.

Dienste bekommen den Anfragenden weiter als `uid` (oder in einer `Sicht`). Damit es
trotzdem nur eine Quelle gibt, prüft der Haushalt, der „wer fragt“ auslegt
(`haushaltVon`, `schreibbereich`, `darfSchreibenFuer`, `siehtKonto`), dass dieses Konto
das des Rahmens ist (`pruefeAnfragender`). Ein anderes wirft `FremdesKonto`, statt
still nur zu sehen, was der Zeilenschutz des Anfragenden zeigt; im Systemrahmen gilt
jedes Konto. Wer für ein anderes Konto arbeitet, sagt es am Aufruf (`alsAnfrage`,
`imSystemkontext`).

## Fehler

Eine Regel je Weg, damit ein Fehler nie wie ein Ergebnis aussieht:

- **Ein Fehlerweg.** Eine Absage ist ein `Fachfehler` mit `FehlerArt`
  (`fachfehler()`, für einen Lesepfad ohne Treffer `nichtGefunden()`); den Status
  wählt nur `src/http/fehlerArt.ts`, die Antwort schreibt nur `fehlerAntwort`.
  Felder neben `code` und `error` (etwa `wartenSek`) trägt der Fehler als `zusatz`.
  Dienste geben keine Absage als Ergebnis zurück (`{ fehler }`, `{ ok: false }`),
  Routen rufen kein `sendeFehler` (`test/schichten.test.js`; die eine Ausnahme ist die
  Uhr in `rumpfFrist`, die nach `next()` läuft). Alles andere fliegt weiter bis zum
  Fehlerweg der App oder des Auftrags.
- **Lesepfade** mit Teilen, die ausfallen dürfen, nehmen `versuche()` oder
  `Abstriche` (`src/infra/ergebnis.ts`): Die Antwort nennt sie in `degradiert`.
- **`logAndContinue`** nur für Nebenwirkungen ohne Folgen für das Ergebnis: Mail
  und Signal nebenher, Fortschritt und Stand, Aufräumen nach dem eigentlichen
  Fehler, Herunterfahren. Einen Ersatzwert liefert `meldeUndLiefere` und nennt
  sein Warum im Code. `test/ratschen.test.js` zählt beide, dazu jeden Fang in
  `src/`, der nur meldet und weiterläuft (`catch (e) { meldeFehler(…) }`, auch mit
  `return x` danach): Er ist ein Ersatzwert ohne Namen. Wer dort direkt in die
  Konsole schreibt, nennt sein Warum als „Ausnahme:“. Die Oberfläche hat eine
  eigene Ratsche für Fänge ohne Meldung (`public/js`).
- Ein Signal ist eine **Fehlerklasse** (`StromGeschlossen`, `AuftragVerloren` …),
  keine Zeichenkette, die der Fänger vergleicht.
- Der Transaktionswächter (kein Ersatzwert in einer laufenden Transaktion) ist die
  Transaktion selbst: Ihr Stand (`neuerTxStand`, `db/transaktion.ts`) reist im
  Aufrufrahmen, kein Zustand des Prozesses.

## Zeilenschutz: was er leistet und was nicht

Der Zeilenschutz (Migrationen 0111, 0112) fängt einen **vergessenen Filter** auf
`user_id`: In 34 Tabellen mit Kontodaten (Bestand, Käufe, Merkliste, Einstellungen
je Konto, Zugangsdaten wie `api_tokens`, `passkeys`, `second_factor`, Aufträge)
sieht und ändert die Laufzeitrolle nur Zeilen von `app.konto` und dessen direkten
Unterkonten, ohne Konto keine. Zugangsdaten (Passkeys, zweiter Faktor, Tokens,
Geräteschlüssel, Schrittfreigaben) sieht nur das Konto selbst, kein Hauptkonto
(Migration 0114). Die Datenbankschicht setzt `app.konto` je
Transaktion (`set_config(…, true)`) aus dem Konto der Anfrage. Den Systemrahmen
trägt die Systemrolle (`BYPASSRLS`), keine Einstellung.

Er ist **keine Grenze gegen eingeschleustes SQL**:

- `app.konto` ist eine Sitzungseinstellung. `set_config('app.konto', …)` darf jede
  Rolle aufrufen; wer SQL über die Laufzeitrolle ausführen kann, setzt sich jedes
  Konto und sieht dessen Zeilen. Dagegen schützen nur Parameter statt
  zusammengesetzter Abfragen.
- Der Haushalt (Migration 0115): `account_links` liest jedes Konto, anlegen darf
  nur der Systemrahmen, lösen nur ein beteiligtes Konto; `account_link_invites`
  und `household_former_links` sieht nur ein beteiligtes Konto.
- Ohne Zeilenschutz sind `users`, `admin_log`, `rate_limit_attempts`,
  `global_settings`, Kataloge, Preis- und Bildzwischenspeicher, Laufzustände.
  Hier schützt der Filter im Repository, bei den ersten dreien zusätzlich das
  Recht der Rolle (unten).
- Die Systemrolle sieht alles. Was im Systemrahmen läuft (Anmeldung vor dem Konto,
  Aufträge, Verwaltung über Konten, Haushaltswährung), prüft die Berechtigung selbst.
- Die Laufzeitrolle hat `SELECT, INSERT, UPDATE, DELETE` auf alle Tabellen
  (`postgres/app-rolle.sh`) mit diesen Ausnahmen: `users.password_hash` liest sie
  nicht, `user_sessions` gar nicht; in `users` schreibt sie nur `first_name` und
  `last_name`, `global_settings` liest sie nur (Migration 0117). Anmeldung,
  Sitzungsspeicher, Passwort, Rechte, Adresse, Sitzungsversion und globale
  Einstellungen laufen über die Systemrolle (`imSystem(…)` im Kontext des
  Bereichs). `admin_log` ist für beide Rollen nur anfügbar; aufgeräumt
  wird über `verwaltungsprotokoll_aufraeumen()` (feste Frist, Eigentümerin).
- Gutscheine und Idempotenzeinträge sieht wie die Zugangsdaten nur das eigene
  Konto (Migration 0118). Kopien vor Migrationen (`vor_migration_*`) haben RLS ohne Policy und
  sind damit nur für die Systemrolle und die Eigentümerin lesbar.

## Rangfolge der Bereiche

Ein Bereich importiert nur Bereiche tieferer Stufen, auch mit `import type`;
Bereiche derselben Stufe kennen einander nicht. Die Kanten löst der Übersetzer
auf (`tsc --explainFiles`). Von unten nach oben:

| Stufe | Bereiche |
|---|---|
| 1 | `src/infra` |
| 2 | `src/vertrag` |
| 3 | `src/http` |
| 4 | `db`, `clients` |
| 5 | `src/throttle` |
| 6 | `src/settings` |
| 7 | `src/mail` |
| 8 | `src/auftraege` |
| 9 | `src/fremdquellen` |
| 10 | `src/haushalt`, `src/geraete`, `src/factors` |
| 11 | `src/konto` |
| 12 | `src/bilder`, `src/profile` |
| 13 | `src/idempotency`, `src/katalog` |
| 14 | `src/finanzen` |
| 15 | `src/bestand` |
| 16 | `src/sets` |
| 17 | `src/parts`, `src/minifigs`, `src/wanted`, `src/vouchers` |
| 18 | `src/collection`, `src/management` |
| 19 | `src/dienste.ts` |
| 20 | `jobs`, `routes` |
| 21 | `startup` |
| 22 | `server.ts` |

## Schema

Die Wahrheit sind die Migrationen in `db/migrations/`. Daraus erzeugen
`npm run schema:stand` und `npm run schema:zeilen` drei Dateien, alle geprüft:

| Datei | Wozu | Prüfung |
|---|---|---|
| `db/basis.sql` | Erststart: eine leere Datenbank bekommt dieses Abbild der ersten N Migrationen, danach laufen nur die jüngeren | `test/schema-basis-db.test.js`: lückenlose Folge vorhandener Migrationen; mit gleichem pg_dump erzeugt das Abbild sich selbst |
| `db/schema-stand.sql` | Lesefassung des Schemas nach allen Migrationen, für Reviews | `test/schema-frisch-db.test.js`: gleich dem Schema einer frisch gestarteten Datenbank |
| `db/zeilen.ts` | Zeilentypen je Tabelle (`npm run schema:zeilen`): Repositories binden ihre Zeilen daran (`Spalten<'price_cache', 'avg_price'>`) | `test/zeilentypen-db.test.js`: Spalten und NULL wie in der Datenbank, jeder Typ kommt so an |

Von Hand geändert wird keine davon; eine Schemaänderung ist immer eine
neue Migration.

## Tabellen und Besitzer

Jede Tabelle hat genau einen Besitzer: Nur sein Bereich schreibt hinein (INSERT, UPDATE,
DELETE). Andere Bereiche rufen dessen Dienst, in einer Transaktion über den Kontext `t`.
Fremde Bereiche lesen über Lesebausteine in `db/` (`katalogSicht.ts`, `haushaltSicht.ts`,
`zugangSicht.ts`, `bestandSicht.ts`, `kontoSicht.ts`, `bestandsmenge.ts`) oder über den Dienst
des Besitzers. Ein Lesebaustein ist keine eigene Stufe: Sein SQL zählt beim Bereich, der ihn
einbindet. Die Stufen gelten deshalb auch für Daten:

- Liegt der Leser über dem Besitzer, importiert er den Baustein.
- Liegt er darunter (Einstellungen, Aufträge, Haushalt, Geräte, Bilder, Katalog, Finanzen,
  Bestand), nennt er in `src/<bereich>/lesevertrag.ts` die Form, die er braucht (Unterabfragen
  mit festen Spalten), und bekommt sie als `lesevertrag` im Kontext. Gefüllt wird der Vertrag
  aus `LESEVERTRAG` in `src/dienste.ts` (Stufe 19, über jedem Besitzer); die Repositories nehmen
  ihn nach dem Zugang (`mitVertrag`). Wer eine Tabelle umbaut, passt den Baustein an, der
  Vertrag des Lesers bleibt.
- Die Kontobedingung eines Bausteins ist nur ein Platzhalter (`Konten` in `db/konten.ts`:
  `= $n` oder `= ANY($n)`).

`test/gemeinsame-tabellen-db.test.js` teilt die Lesestellen ein: Aufwärts gibt es keine, weder
direkt noch über `db/` (was ein Baustein liest, zeigt sein Ergebnis); Lesen des Katalogs und
direkt abwärts zählen je eine Ratsche, die nur sinken darf. Ein Trigger schreibt nur in Tabellen
seines Besitzers; die Ausnahmen (Teilezähler, Vormerkung für die Teile-Zusammenfassung) stehen
begründet in `TRIGGER_FREMDZIELE` desselben Tests. Einzige schreibende
Ausnahme: Der Schemastart (`db/schemaStart.ts`) setzt die Zeitzone in `global_settings`,
bevor es Dienste gibt. Die Tabelle hier ist die Quelle für den Test.

Die Bestandszeilen eines Kontos (Sets, Teile, Figuren, ihre Käufe, Orte, Papierkorb) gehören
`src/bestand`: Papierkorb, Lagerorte und Tageserfassung arbeiten über alle drei Arten, und nur der
tiefste Bereich, der sie schreibt, kann von den anderen gerufen werden. Sets, Teile und Figuren
schreiben über `t.bestand`. Wählt eine Datei den Tabellennamen zur Laufzeit, misst der Test, was sie
liest und schreibt (`DYNAMISCH`); dafür gelten dieselben Regeln.

| Besitzer | Tabellen |
|---|---|
| `db` | `schema_migrations` |
| `src/infra` | `app_logs` |
| `src/throttle` | `rate_limit_attempts` |
| `src/settings` | `global_settings`, `user_settings` |
| `src/auftraege` | `jobs`, `job_exclusive_locks`, `job_pauses`, `job_types`, `import_status`, `run_state` |
| `src/fremdquellen` | `api_calls`, `api_cadence` |
| `src/haushalt` | `account_link_invites`, `account_links`, `household_former_links` |
| `src/geraete` | `device_nonces`, `device_keys`, `step_up_challenges`, `step_up_approvals` |
| `src/factors` | `passkeys`, `webauthn_challenges`, `second_factor`, `second_factor_codes` |
| `src/konto` | `api_tokens`, `api_tokens_consumed`, `qr_login_tokens`, `user_sessions`, `users`, `admin_takeovers`, `admin_log` |
| `src/bilder` | `image_misses`, `image_wanted` |
| `src/idempotency` | `idempotency` |
| `src/katalog` | `bl_mapping`, `bl_mapping_custom`, `catalog_cache`, `minifig_custom`, `minifig_parts_cache`, `minifigs_catalog`, `part_catalog`, `part_color_catalog`, `rb_colors`, `rb_inventories`, `rb_inventory_minifigs`, `rb_inventory_parts`, `rb_part_categories`, `rb_parts`, `rb_sets`, `rb_themes`, `set_catalog`, `set_minifigs`, `set_parts`, `shared_instructions`, `subsets_cache`, `part_custom`, `part_color_custom` |
| `src/finanzen` | `minifig_price_cache`, `minifig_price_history`, `part_price_cache`, `part_price_history`, `price_alerts`, `price_cache`, `price_history`, `exchange_rates` |
| `src/bestand` | `minifig_acquisitions`, `minifigs`, `trash`, `part_acquisitions`, `parts`, `set_acquisitions`, `sets`, `storage_locations` |
| `src/sets` | `instructions` |
| `src/parts` | `parts_catalog_pending`, `parts_summary`, `parts_summary_state`, `parts_version_user` |
| `src/wanted` | `wanted` |
| `src/vouchers` | `voucher_balance_throttle`, `vouchers` |

## API-Vertrag

`src/vertrag/` beschreibt jede Route mit zod: Antwort und, für jede
schreibende Route, die Eingabe. Daraus entstehen die Routentypen (tsc),
`docs/openapi.json` (`npm run vertrag:openapi`), die Typen der Oberfläche und die
Kotlin-Antworttypen der App (`vertrag.erzeugt`). Der Vertrag ist die einzige
Eingabeprüfung und liefert das Fachformat: Was eine Route liest, hat der Vertrag schon
umgeformt (`z.transform`, z. B. `ZUSTAND` 'n' → 'N', `KENNUNG` → Zahl); eine Route wandelt
`req.eingabe`, `req.abfrage` und `req.pfad` nicht nach (`test/schichten.test.js`).
Ein Ereignisstrom (`art: 'strom'`) nennt sein Ereignis (`ereignis`); die Oberfläche öffnet ihn nur
über `strom()` in `public/js/api.js` und bekommt den Typ aus `Strom` (`frontend-typen/vertrag.d.ts`).

Was die App vom Server braucht (Routen, Abfrage, Rumpffelder, die Felder ihrer
Modelle), steht in `shared/app-schnittstelle.json`. Der Android-Lauf erzeugt und prüft
die Datei aus dem Kotlin-Quelltext (`Android-App/tools/vertrag/`), die Web-Suite prüft den
Server gegen sie (`test/app-schnittstelle.test.js`, `vertrag-lesen-db`,
`vertrag-schreiben-db`). Kotlin-Quelltext liest die Web-Suite nicht (`test/ratschen.test.js`).

Eine Route registriert sich über ihren Schlüssel:
`router.endpunkt('GET /api/v1/sets/:setNumber', requireToken, async req => …)`.
Methode, Pfad und die Typen von `req`/`res` kommen aus ihm; der Router kennt sein
Präfix (`vertragsRouter('/api/v1')`), ein Schlüssel ausserhalb kompiliert nicht, und
unter fremdem Präfix eingehängt antwortet er 500. Die Route gibt ihr Ergebnis zurück,
der Router setzt `{ success: true, … }` davor (die App liest `success`); eine Route,
deren Vertrag kein `success` nennt, antwortet selbst. Die Typprobe steht in
`test/typen/vertragsRouter.typprobe.ts`.

### Namen

Pfade und Feldnamen der API sind Vertrag: App und Webapp hängen daran, sie
bleiben, wie sie sind, auch wo sie uneinheitlich sind. Neue Routen und Felder
folgen der Mehrheit: Pfade englisch im Plural mit Bindestrich, Pfadparameter
`:setNumber`, `:partNumber`, `:figNumber`, `:id`; Felder `snake_case`.
Bestand der Abweichungen (Stand 11.11.2026):

| Art | Beispiele |
|---|---|
| Sprache gemischt | `/admin/auftraege` neben `/admin/jobs`, `/auth/zweiter-faktor` neben `/auth/change-password`, `/papierkorb`, `/wanted/…/uebernehmen`, `/settings/einrichtung` |
| gleiche Sache, zwei Namen | Felder `set_number`/`nummer`, `condition`/`zustand`, `currency`/`currency_code`/`waehrung`, `quantity`/`menge`, `storage`/`ort`; „Job“ und „Auftrag“ für die Hintergrundarbeit (`/admin/jobs`, `/admin/job-status` neben `/admin/auftraege`) |
| Parameter | `:sn` (`/sets/:sn/move`) statt `:setNumber`; Abkürzungen `:acqId`, `:instrId`, `:tokenId`, `:jobId` |
| Schreibweise | `camelCase` in einigen Antworten (`isAdmin`, `mustChangePassword`, `jobId`, `etaSeconds`) |
| Form | `/sets/:setNumber/alert` neben `/alerts`; `parts-list`, `minifigs-list`, aber `partslist-pdf`; `/wanted-list/import/xml` neben `/wanted/import/csv`; `/finance/pnl` |

Innen (Funktionen, Typen) heissen die Dinge deutsch und wie im Bereich:
`haushaltVon`, `schreibbereich`, `blickfeldIds`, `darfSchreibenFuer`,
`preisverlaufSet`/`…Teil`/`…Figur`. Übrig sind englische Namen vor allem in
Finanzen, Katalog und Mail (`holePreis`, `setZustand`, `aktuellerMarktpreis`);
`test/ratschen.test.js` zählt die exportierten Funktionen in `src/` mit englischem Verb.
Eine Regel hat einen Namen: Setnummern normalisiert nur `normalisiereSetNummer`
(`src/infra/setNummer`), Sets verschiebt `setVerschieben` (Einstieg) über
`setErfassungenUmhaengen`; Bild- und Quellenhelfer importiert man aus `bilder` bzw.
`fremdquellen`, nicht über `katalog`.

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
`scripts/build-frontend.js` (`KERN`, `BAUSTEINE`); alles übrige ist Ansicht.

| Schicht | Dateien | Regel |
|---|---|---|
| Kern | `KERN` (`state.js`, `events.js`, `escaping.js` …), `public/i18n.js` | kennt keine Ansicht |
| Bausteine | `BAUSTEINE` (`api.js`, `dom.js`, `format.js` …) | kennt keine Ansicht; `api.js` ist der einzige Weg zum Server |
| Ansichten | alle übrigen Module unter `public/js/` | dürfen Kern und Bausteine importieren |

- **Handler:** Markup nennt Aktionen nur als `data-click`, `data-change` …;
  `public/js/registry.js` ordnet sie den registrierten Funktionen zu (die CSP
  verbietet Inline-Handler).
- **Rückwege ohne Importkreis:** Ansichten melden Ereignisse
  (`public/js/events.js`, `emit`/`subscribe`) statt einander zu importieren.
- **Geteilter Zustand** steht nur in `public/js/state.js` (mit Settern).
- **Markup** entsteht mit dem Tag `html` (`public/js/escaping.js`, maskiert jeden
  Wert) und kommt nur über `setzeHtml()`/`fuegeHtmlEin()` (`public/js/dom.js`)
  in die Seite. Inline-Stile heissen `data-stil` und werden von
  `public/js/styles.js` gegen eine beim Bauen erzeugte Freigabeliste gesetzt.
- **Texte:** `t()` maskiert eingesetzte Werte für Markup, `tRaw()` nicht (für
  `textContent`); beide aus `public/i18n.js`.
- **Typen:** `tsconfig.frontend.json` prüft die Module streng (JSDoc, `strict`),
  die Routentypen kommen aus `frontend-typen/vertrag.d.ts` (aus dem API-Vertrag erzeugt).

Die Schichten prüft `test/frontend-architektur.test.js`, das Verhalten prüfen
die jsdom-Tests über `test/helpers/oberflaeche.js` (echtes `index.html`,
echtes Bündel, Antworten gegen den Vertrag) und die Chrome-Tests über
`test/helpers/app-browser.js`.
