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
| 2 | `db`, `clients` |
| 3 | `src/einstellungen` |
| 4 | `src/mail` |
| 5 | `src/auftraege` |
| 6 | `src/haushalt` |
| 7 | `src/konto` |
| 8 | `src/idempotenz`, `src/katalog` |
| 9 | `src/finanzen` |
| 10 | `src/bestand` |
| 11 | `src/sets` |
| 12 | `src/teile`, `src/figuren`, `src/merkliste`, `src/gutscheine` |
| 13 | `src/sammlung`, `src/verwaltung` |
| 14 | `jobs`, `routes` |
| 15 | `startup` |
| 16 | `server.ts` |

## API-Vertrag

`src/infra/vertrag/` beschreibt jede Route mit zod: Antwort und, für jede
schreibende Route, die Eingabe. Daraus entstehen die Routentypen (tsc),
`docs/openapi.json` (`npm run vertrag:openapi`) und der Abgleich mit dem
Android-Client (`test/vertrag-kotlin.test.js`).

## Begründungen

Lange Begründungen einzelner Stellen liegen unter `docs/begruendungen/`;
der Code verweist mit `Ausführlich: docs/begruendungen/…#anker`.
