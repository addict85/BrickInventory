# Architektur der Web-App

Kurzüberblick. Die Regeln selbst prüft `test/schichten.test.js`; dieses
Dokument sagt, wo was hingehört. Ändert sich die Rangfolge dort, ändert sie
sich hier (der Test vergleicht beide).

## Prozesse

| Rolle (`ROLLE`) | Aufgabe |
|---|---|
| `web` | HTTP: Oberfläche (`public/`), API unter `/api/v1`, Bild-Proxy |
| `jobs` | Hintergrundarbeit aus der Auftragstabelle (`auftraege`), Zeitpläne |
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
- Die HTTP-Hülle, die jede Schicht braucht: Fehlerantwort (`sendeFehler` in
  `fehlerTexte`, `httpAntwort`), Vertrag (`vertrag/`), Datei-Ein- und -Ausgang,
  Budget und Schranken je Konto, Sitzungskeks, Proxy-Vertrauen. Express
  importieren nur Dateien daraus; welche, hält der Test in
  `test/schichten.test.js` fest. Dienste kennen Express nicht; was sie von der
  Anfrage brauchen, trägt der Aufrufrahmen (`kontoKontext`, siehe unten).

- Jeder Fachbereich hat eine `index.ts`; andere Bereiche, Routen, Jobs und
  `startup/` importieren nur darüber (ausser den HTTP-Seiten unter
  `src/<bereich>/http/`). So bleibt der Schnitt der Dateien Sache des Bereichs.

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
  steht ausgeschrieben da (`getSets: mit(k)(lesen.getSets)`), typgeprüft, ohne
  Namenslisten und ohne Proxy. `startup/verdrahtung.ts` baut alle Bereiche in
  `baueDienste(db, bauteile)`; Server und Testhilfe rufen dieselbe Funktion.
- Routen sind Fabriken (`baueXRouter(d: Pick<Dienste, …>)`, Typ aus `src/dienste.ts`) und
  rufen Dienste nur über `d`; von `startup/` importieren sie nichts. Die
  Fassaden der `index.ts` und `xBereich()` holen die Dienste des Prozesses; sie
  bleiben für HTTP-Seiten, Jobs, den Start und Tests (gezählt in `test/ratschen.test.js`).
- Mehrstufige Schreibvorgänge (Änderung und Protokoll, Zeile und Datei) sind ein
  Dienst mit `k.transaktion(async t => …)`: Der Rumpf schreibt über `t`, einen
  Kontext an der Verbindung der Transaktion. `t` ist ganz über deren Zugang gebaut
  (`tx.db`): Jeder Satz Dienste tieferer Bereiche entsteht darüber neu
  (`ueber(tx.db)`, je Transaktion einmal), Zustand im Speicher bleibt geteilt. So
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
  `src/<bereich>/http/` (Anmeldung und Sitzung in `konto`, Bild-Proxy in
  `bilder`, Idempotenz-Middleware). Fachdienste importieren weder Express noch
  eine HTTP-Seite; eine Absage ist eine `FehlerArt` (oder ein `Fachfehler`),
  den HTTP-Status wählt `src/http/fehlerArt.ts`.
- Clients erreicht man nur über `src/fremdquellen/quellen.ts`. Jeder Klient
  entsteht dort je Satz Dienste (`erzeugeRebrickable(z)` …) mit Schlüssel,
  Kontingent und Drossel seines Zugangs (`clients/zugang.ts`); einen Zugang des
  Prozesses gibt es nicht. Tests stellen Klienten mit `testQuellen()`.
- Fragt mitten in einer Transaktion jemand über den ungebundenen Zugang (`k` statt
  `t`), wirft die Datenbankschicht `UngebundeneAbfrage`: Sie liefe sonst über eine
  zweite Verbindung neben der Transaktion. Erkannt wird das am Aufrufrahmen; ein Weg
  in die Transaktion ist er nicht.
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
jedes Konto. Wer für ein anderes Konto arbeitet, sagt es am Aufruf (`imNamenVon`,
`imSystemkontext`).

## Fehler

Eine Regel je Weg, damit ein Fehler nie wie ein Ergebnis aussieht:

- **Schreibpfade werfen.** Eine Absage ist ein `Fachfehler` mit `FehlerArt`; den
  Status wählt `src/http/fehlerArt.ts`. Alles andere fliegt weiter bis zum
  Fehlerweg des Routers oder des Auftrags.
- **Lesepfade** mit Teilen, die ausfallen dürfen, nehmen `versuche()` oder
  `Abstriche` (`src/infra/ergebnis.ts`): Die Antwort nennt sie in `degradiert`.
- **`logAndContinue`** nur für Nebenwirkungen ohne Folgen für das Ergebnis: Mail
  und Signal nebenher, Fortschritt und Stand, Aufräumen nach dem eigentlichen
  Fehler, Herunterfahren. Einen Ersatzwert liefert `meldeUndLiefere` und nennt
  sein Warum im Code. `test/ratschen.test.js` zählt beide.
- Ein Signal ist eine **Fehlerklasse** (`StromGeschlossen`, `AuftragVerloren` …),
  keine Zeichenkette, die der Fänger vergleicht.
- Der Transaktionswächter (kein Ersatzwert in einer laufenden Transaktion) kommt
  mit dem Zugang: `erzeugeDb()` setzt ihn, kein Import.

## Zeilenschutz: was er leistet und was nicht

Der Zeilenschutz (Migrationen 0111, 0112) fängt einen **vergessenen Filter** auf
`user_id`: In 34 Tabellen mit Kontodaten (Bestand, Käufe, Merkliste, Einstellungen
je Konto, Zugangsdaten wie `api_tokens`, `passkeys`, `zweiter_faktor`, Aufträge)
sieht und ändert die Laufzeitrolle nur Zeilen von `app.konto` und dessen direkten
Unterkonten, ohne Konto keine. Die Datenbankschicht setzt `app.konto` je
Transaktion (`set_config(…, true)`) aus dem Konto der Anfrage. Den Systemrahmen
trägt die Systemrolle (`BYPASSRLS`), keine Einstellung.

Er ist **keine Grenze gegen eingeschleustes SQL**:

- `app.konto` ist eine Sitzungseinstellung. `set_config('app.konto', …)` darf jede
  Rolle aufrufen; wer SQL über die Laufzeitrolle ausführen kann, setzt sich jedes
  Konto und sieht dessen Zeilen. Dagegen schützen nur Parameter statt
  zusammengesetzter Abfragen.
- Ohne Zeilenschutz sind Tabellen ohne `user_id` je Konto oder mit Zeilen mehrerer
  Konten: `users`, `user_sessions`, `account_links`, `account_link_invites`,
  `household_former_links`, `verwaltungsprotokoll`, `rate_limit_attempts`,
  `global_settings`, Kataloge, Preis- und Bildzwischenspeicher, Laufzustände.
  Hier schützt allein der Filter im Repository.
- Die Systemrolle sieht alles. Was im Systemrahmen läuft (Anmeldung vor dem Konto,
  Aufträge, Verwaltung über Konten, Haushaltswährung), prüft die Berechtigung selbst.
- Die Laufzeitrolle hat `SELECT, INSERT, UPDATE, DELETE` auf alle Tabellen
  (`postgres/app-rolle.sh`); Spalten- oder Tabellenrechte trennen nichts weiter.

## Rangfolge der Bereiche

Ein Bereich importiert nur Bereiche tieferer Stufen; Bereiche derselben Stufe
kennen einander nicht. Von unten nach oben:

| Stufe | Bereiche |
|---|---|
| 1 | `src/infra` |
| 2 | `src/vertrag` |
| 3 | `src/http` |
| 4 | `db`, `clients` |
| 5 | `src/einstellungen` |
| 6 | `src/mail` |
| 7 | `src/auftraege` |
| 8 | `src/fremdquellen` |
| 9 | `src/haushalt` |
| 10 | `src/konto` |
| 11 | `src/bilder` |
| 12 | `src/idempotenz`, `src/katalog` |
| 13 | `src/finanzen` |
| 14 | `src/bestand` |
| 15 | `src/sets` |
| 16 | `src/teile`, `src/figuren`, `src/merkliste`, `src/gutscheine` |
| 17 | `src/sammlung`, `src/verwaltung` |
| 18 | `jobs`, `routes` |
| 19 | `startup` |
| 20 | `server.ts` |

## Schema

Die Wahrheit sind die Migrationen in `db/migrations/`. Daraus erzeugt
`npm run schema:stand` zwei Dateien, beide geprüft:

| Datei | Wozu | Prüfung |
|---|---|---|
| `db/basis.sql` | Erststart: eine leere Datenbank bekommt dieses Abbild der ersten N Migrationen, danach laufen nur die jüngeren | `test/schema-basis-db.test.js`: lückenlose Folge vorhandener Migrationen; mit gleichem pg_dump erzeugt das Abbild sich selbst |
| `db/schema-stand.sql` | Lesefassung des Schemas nach allen Migrationen, für Reviews | `test/schema-frisch-db.test.js`: gleich dem Schema einer frisch gestarteten Datenbank |

Von Hand geändert wird keine der beiden; eine Schemaänderung ist immer eine
neue Migration.

## API-Vertrag

`src/vertrag/` beschreibt jede Route mit zod: Antwort und, für jede
schreibende Route, die Eingabe. Daraus entstehen die Routentypen (tsc),
`docs/openapi.json` (`npm run vertrag:openapi`) und der Abgleich mit dem
Android-Client (`test/vertrag-kotlin.test.js`).

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
`preisverlaufSet`/`…Teil`/`…Figur`. Übrig sind englische Namen in
Finanzen und Katalog (`fetchPrice`, `resolveSetCondition`, `getCurrentMarketPrice`).

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
| Kern | `KERN` (`zustand.js`, `ereignisse.js`, `escapen.js` …), `public/i18n.js` | kennt keine Ansicht |
| Bausteine | `BAUSTEINE` (`api.js`, `dom.js`, `format.js` …) | kennt keine Ansicht; `api.js` ist der einzige Weg zum Server |
| Ansichten | alle übrigen Module unter `public/js/` | dürfen Kern und Bausteine importieren |

- **Handler:** Markup nennt Aktionen nur als `data-click`, `data-change` …;
  `public/js/registry.js` ordnet sie den registrierten Funktionen zu (die CSP
  verbietet Inline-Handler).
- **Rückwege ohne Importkreis:** Ansichten melden Ereignisse
  (`public/js/ereignisse.js`, `melde`/`abonniere`) statt einander zu importieren.
- **Geteilter Zustand** steht nur in `public/js/zustand.js` (mit Settern).
- **Markup** entsteht mit dem Tag `html` (`public/js/escapen.js`, maskiert jeden
  Wert) und kommt nur über `setzeHtml()`/`fuegeHtmlEin()` (`public/js/dom.js`)
  in die Seite. Inline-Stile heissen `data-stil` und werden von
  `public/js/stile.js` gegen eine beim Bauen erzeugte Freigabeliste gesetzt.
- **Texte:** `t()` maskiert eingesetzte Werte für Markup, `tRaw()` nicht (für
  `textContent`); beide aus `public/i18n.js`.
- **Typen:** `tsconfig.frontend.json` prüft die Module streng (JSDoc, `strict`),
  die Routentypen kommen aus `frontend-typen/vertrag.d.ts` (aus dem API-Vertrag erzeugt).

Die Schichten prüft `test/frontend-architektur.test.js`, das Verhalten prüfen
die jsdom-Tests über `test/helpers/oberflaeche.js` (echtes `index.html`,
echtes Bündel, Antworten gegen den Vertrag) und die Chrome-Tests über
`test/helpers/app-browser.js`.
