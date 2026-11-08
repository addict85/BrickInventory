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
server.ts, startup/     hängt alles ein
routes/                 HTTP: Eingabe prüfen (Vertrag), Dienst rufen, antworten
jobs/                   Hintergrundarbeit, ruft Dienste
src/<bereich>/          Dienste (Fachlogik) und repository (SQL)
db/, clients/           Datenbank und Aussenwelt (nur HTTP)
src/vertrag/            der API-Vertrag (zod-Schemas, Prüfung, OpenAPI), von allen Bereichen geteilt
src/infra/              fachfreie Helfer
```

- SQL steht nur in `src/<bereich>/repository*` und `db/`.
- Routen importieren nichts aus `db/`, `jobs/` oder `clients/`; sie fangen
  keine Fehler, der Fehlerweg des Routers antwortet.
- Clients erreicht man nur über `src/katalog/quellen.ts`; Schlüssel und
  Kontingent bekommen sie dort übergeben (`clients/zugang.ts`).
- Eine Transaktion (`db.transaction`) gilt für den ganzen Aufrufpfad, auch
  für Repositories ohne `tx`-Parameter.

## Rangfolge der Bereiche

Ein Bereich importiert nur Bereiche tieferer Stufen; Bereiche derselben Stufe
kennen einander nicht. Von unten nach oben:

| Stufe | Bereiche |
|---|---|
| 1 | `src/infra` |
| 2 | `src/vertrag` |
| 3 | `db`, `clients` |
| 4 | `src/einstellungen` |
| 5 | `src/mail` |
| 6 | `src/auftraege` |
| 7 | `src/haushalt` |
| 8 | `src/konto` |
| 9 | `src/idempotenz`, `src/katalog` |
| 10 | `src/finanzen` |
| 11 | `src/bestand` |
| 12 | `src/sets` |
| 13 | `src/teile`, `src/figuren`, `src/merkliste`, `src/gutscheine` |
| 14 | `src/sammlung`, `src/verwaltung` |
| 15 | `jobs`, `routes` |
| 16 | `startup` |
| 17 | `server.ts` |

## API-Vertrag

`src/vertrag/` beschreibt jede Route mit zod: Antwort und, für jede
schreibende Route, die Eingabe. Daraus entstehen die Routentypen (tsc),
`docs/openapi.json` (`npm run vertrag:openapi`) und der Abgleich mit dem
Android-Client (`test/vertrag-kotlin.test.js`).

## Begründungen

Lange Begründungen einzelner Stellen liegen unter `docs/begruendungen/`;
der Code verweist mit `Ausführlich: docs/begruendungen/…#anker`.

## Oberfläche

`public/` ist eine Seite (`index.html`) mit einem Bündel. `npm run build:frontend`
(esbuild, `scripts/build-frontend.js`) macht aus `public/js/main.js` und allem,
was es importiert, `public/js/app.bundle.js` (IIFE, minifiziert, eingecheckt;
die CI prüft, dass es zu den Quellen passt). Ausserhalb des Bündels laufen nur
`public/js/00-theme-boot.js` (Design vor dem ersten Bild), die Wörterbücher
`public/locales/de.js` und `public/locales/en.js`, `public/js/pdfjs-boot.js`
und `public/js/logviewer.js`.

| Schicht | Dateien | Regel |
|---|---|---|
| Kern | `00-*.js`, `public/i18n.js` | kennt keine Ansicht |
| Bausteine | `01-*.js` | kennt keine Ansicht; `01-api.js` ist der einzige Weg zum Server |
| Ansichten | `02-*.js` bis `26-*.js` | dürfen Kern und Bausteine importieren |

- **Handler:** Markup nennt Aktionen nur als `data-click`, `data-change` …;
  `public/js/00-registry.js` ordnet sie den registrierten Funktionen zu (die CSP
  verbietet Inline-Handler).
- **Rückwege ohne Importkreis:** Ansichten melden Ereignisse
  (`public/js/00-ereignisse.js`, `melde`/`abonniere`) statt einander zu importieren.
- **Geteilter Zustand** steht nur in `public/js/00-zustand.js` (mit Settern).
- **Markup** entsteht mit dem Tag `html` (`public/js/00-escapen.js`, maskiert jeden
  Wert) und kommt nur über `setzeHtml()`/`fuegeHtmlEin()` (`public/js/01-dom.js`)
  in die Seite. Inline-Stile heissen `data-stil` und werden von
  `public/js/00-stile.js` gegen eine beim Bauen erzeugte Freigabeliste gesetzt.
- **Texte:** `t()` maskiert eingesetzte Werte für Markup, `tRaw()` nicht (für
  `textContent`); beide aus `public/i18n.js`.
- **Typen:** `tsconfig.frontend.json` prüft die Module streng (JSDoc, `strict`),
  die Routentypen kommen aus `frontend-typen/vertrag.d.ts` (aus dem API-Vertrag erzeugt).

Die Schichten prüft `test/frontend-architektur.test.js`, das Verhalten prüfen
die jsdom-Tests über `test/helpers/oberflaeche.js` (echtes `index.html`,
echtes Bündel, Antworten gegen den Vertrag) und die Chrome-Tests über
`test/helpers/app-browser.js`.
