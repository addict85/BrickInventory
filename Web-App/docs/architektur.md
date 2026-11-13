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
  `test/schichten.test.js` fest. Dienste kennen Express nicht, mit einer
  Ausnahme: `kontoKontext` trägt die laufende Anfrage über
  `AsyncLocalStorage` zu Zählern, die keinen Request sehen.

- Jeder Fachbereich hat eine `index.ts`; andere Bereiche, Routen, Jobs und
  `startup/` importieren nur darüber (ausser den HTTP-Seiten unter
  `src/<bereich>/http/`). So bleibt der Schnitt der Dateien Sache des Bereichs.

- SQL steht nur in `src/<bereich>/repository*` und `db/`, auch als Klausel
  (Sortierung, Bedingung, Upsert). Dienste nehmen aus `db/database` nur die
  Arbeitseinheit (`transaction`) und den Betrieb (Pool, eigene Verbindung).
- `jobs/` führt Aufträge aus: Pacht, Wiederholung und Abbruch im Worker, je Art
  ein Aufruf in der Bearbeitertabelle. Was ein Auftrag tut, steht in
  `src/<bereich>/` (Preislauf in `finanzen`, Bildbedarf in `katalog` …); die
  Fehlerarten des Laufs (`AuftragVerschieben` …) kommen aus `src/auftraege`.
- Jeder Bereich hat eine Fabrik (`erzeugeX` in `bereich.ts`) und einen Kontext
  (`kontext.ts`): gebundene Repositories, die Dienste tieferer Bereiche und die
  Arbeitseinheit. Ein Dienst nimmt den Kontext als ersten Parameter (`k`) und holt
  alles daraus, nichts vom Prozess. `startup/verdrahtung.ts` baut alle Bereiche in
  `baueDienste(db, nacharbeit)`; Server und Testhilfe rufen dieselbe Funktion.
- Routen sind Fabriken (`baueXRouter(d)`) und rufen Dienste nur über `d`. Die
  Fassaden der `index.ts` und `xBereich()` holen die Dienste des Prozesses; sie
  bleiben für HTTP-Seiten, Jobs, den Start und Tests (gezählt in `test/ratschen.test.js`).
- Mehrstufige Schreibvorgänge (Änderung und Protokoll, Zeile und Datei) sind ein
  Dienst mit `k.transaktion(async t => …)`: Der Rumpf schreibt über `t`, einen
  Kontext an der Verbindung der Transaktion. So steht am Aufrufort, was zusammen gilt.
- Routen importieren nichts aus `db/`, `jobs/` oder `clients/`. Sie umhüllen
  nichts mit `try/catch`; der Fehlerweg des Routers antwortet. Ein `.catch(…)`
  gibt es nur dort, wo die Antwort einen Ersatzwert braucht (etwa der Token
  beim Anmelden in `routes/auth.ts`: ohne Token ein eigener Fehlercode).
- Express kennen nur die Routen, `server.ts`, `src/http` (Fehlerweg, Herkunft,
  Dateiauslieferung, Vertragsrouter) und die HTTP-Seiten der Bereiche unter
  `src/<bereich>/http/` (Anmeldung und Sitzung in `konto`, Bild-Proxy in
  `katalog`, Idempotenz-Middleware). Fachdienste importieren weder Express noch
  eine HTTP-Seite; eine Absage ist eine `FehlerArt` (oder ein `Fachfehler`),
  den HTTP-Status wählt `src/http/fehlerArt.ts`.
- Clients erreicht man nur über `src/katalog/quellen.ts`; Schlüssel und
  Kontingent bekommen sie dort übergeben (`clients/zugang.ts`).
- Eine Transaktion gilt zusätzlich für den ganzen Aufrufpfad (AsyncLocalStorage),
  auch für Repositories ohne `tx`-Parameter: Sicherung gegen eine zweite
  Verbindung mitten in der Arbeitseinheit, nicht der Weg, sie zu erkennen.

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
| 8 | `src/haushalt` |
| 9 | `src/konto` |
| 10 | `src/idempotenz`, `src/katalog` |
| 11 | `src/finanzen` |
| 12 | `src/bestand` |
| 13 | `src/sets` |
| 14 | `src/teile`, `src/figuren`, `src/merkliste`, `src/gutscheine` |
| 15 | `src/sammlung`, `src/verwaltung` |
| 16 | `jobs`, `routes` |
| 17 | `startup` |
| 18 | `server.ts` |

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
