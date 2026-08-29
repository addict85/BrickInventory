# 🧱 BrickInventory Manager v3.0

Vollständige Node.js Webapp zur Verwaltung deiner Klemmbaustein-Sammlung.

## Features
- **Galerie** – Sets verwalten (einzeln oder per CSV), Bild, Name, Jahr, Thema
- **Teile-Übersicht** – alle Teile aller Sets, gruppiert nach Farbe, filterbar
- **Finanzen** – Marktwert via BrickLink Preisführer
- **Einstellungen** – Benutzerverwaltung, API-Keys, Währung
- **Anleitungen** – automatisch von Brickset heruntergeladen (PDF, lokal gespeichert)
- **Login** – eigene Bibliothek pro Benutzer

## Docker (empfohlen)

```bash
# Starten — alle Standardwerte sind im Dockerfile gesetzt
docker compose up -d --build
# → http://localhost:3000
# Login: admin / admin
```

Einzige Pflicht-Anpassung: `SESSION_SECRET` in `compose.yaml` setzen:
```yaml
environment:
  SESSION_SECRET: hier-langen-zufalls-string-eintragen
```

### Ports / Pfade anpassen
Alles direkt in `compose.yaml` editieren — kein separates `.env` nötig.

```yaml
ports:
  - "8080:3000"        # anderen Host-Port nutzen
volumes:
  - /mnt/data:/app/data   # eigener Datenpfad — enthält auch alle Bilder
```

Bilder brauchen **kein eigenes Volume**: Sie liegen unter `data/images/`
(Sets in `data/images/sets/`, Teile in `data/part_images/`), Vorschaubilder
jeweils als `<name>_thumb.jpg` daneben. Ein Backup von `data/` erfasst damit
alles.

### Datenbankpasswort ändern
In `compose.yaml` und im `Dockerfile` (oder als `environment`-Override):
```yaml
# postgres-Service
environment:
  POSTGRES_PASSWORD: mein-sicheres-passwort

# app-Service
environment:
  PGPASSWORD: mein-sicheres-passwort
```

### DB-Pool-Größe anpassen
Normalerweise **nicht nötig**: Die App rechnet `min(15, 80 / Anzahl Worker)`
selbst aus. Nur wenn die PostgreSQL-Instanz ein abweichendes `max_connections`
hat, in `compose.yaml`:
```yaml
environment:
  PG_POOL_MAX: 40   # mehr parallele Verbindungen
```

## Manuell starten (ohne Compose)

```bash
npm ci             # exakt die Lockfile (statt npm install)
npm run build      # .ts → dist/, Frontend → public/js/app.bundle.js
npm start          # → node dist/server.js
# → http://localhost:3000  (PostgreSQL muss separat laufen)
```

Zum Entwickeln:
```bash
npm run dev        # tsx watch, baut das Frontend-Bündel selbst
npm run typecheck
npm test
```

Nach Änderungen an `public/js/*` oder `public/i18n.js` muss
`npm run build:frontend` laufen — der Server liefert das gebündelte
`app.bundle.js` aus, nicht die Einzeldateien.

## Sicherung

```bash
./scripts/backup.sh            # pg_dump + data/ nach ./backups
```
Ein Dateikopie-Backup von `pgdata/` bei laufendem PostgreSQL ist **wertlos**.
Den Restore-Weg einmal ausprobieren — die Befehle stehen am Ende des Skripts.

## Datenbank im Browser ansehen (pgweb)

Optionales Werkzeug, startet **nicht** mit `docker compose up -d`:

```bash
docker compose --profile tools up -d pgweb    # starten  → http://localhost:8081
docker compose --profile tools down pgweb     # wieder abschalten
```

pgweb ist standardmässig auf **Lesen** beschränkt (`--readonly` in
`compose.yaml`). Für Reparaturen die Zeile dort auskommentieren und den Dienst
neu starten.

> **Wichtig:** pgweb hat **keine Anmeldung**. Wer die Seite erreicht, sieht und
> ändert die ganze Datenbank. Der Port ist deshalb an `127.0.0.1` gebunden und
> nur auf dem Server selbst erreichbar — diese Bindung bitte nicht ändern. Von
> einem anderen Rechner aus geht es per SSH-Tunnel:
>
> ```bash
> ssh -L 8081:127.0.0.1:8081 <benutzer>@<server>
> ```
>
> Danach im lokalen Browser `http://localhost:8081` öffnen. Nach getaner Arbeit
> den Dienst wieder herunterfahren.

## Empfohlene Umgebungsvariablen

| Variable | Wirkung |
|---|---|
| `APP_BASE_URL` | Basis-URL für Links in E-Mails. Ohne sie stammt der Host aus dem Request-Header. |
| `ADMIN_PASSWORD` | Passwort des beim ersten Start angelegten Admins. Sonst wird ein Zufallspasswort erzeugt und **einmalig** ins Log geschrieben. |
| `SESSION_SECRET` | Pflicht in Produktion (der Start bricht sonst ab). |
| `TOKEN_IDLE_DAYS` | Tage ohne Nutzung, nach denen ein App-Token verfällt (Vorgabe `90`, `0` schaltet die Regel ab). Betrifft nur Tokens ohne Ablaufdatum — Android-App und QR-Login. Ein Telefon, das die App regelmässig öffnet, ist nie betroffen; ausgesperrt wird nur, was ohnehin niemand mehr benutzt. |

Siehe `UPGRADE.md` für die Änderungen gegenüber der Vorgängerfassung.

## API-Keys einrichten
**BrickLink:** https://www.bricklink.com/v2/api/register_consumer.page  
→ IP Address: `0.0.0.0`, IP Mask: `0.0.0.0`

**Brickset:** https://brickset.com/tools/webservices/requestkey

## CSV Format
```csv
set_number,quantity
75192,1
10300,2
```


## Tests

```bash
npm test            # komplette Suite (Node-Test-Runner, keine Zusatz-Tools nötig)
npm run test:api    # nur die Postgres-Integrationstests
```

### Zwei Arten von Tests — und wofür jede taugt

Der grössere Teil der Suite prüft den **Quelltext**: liest eine Datei und
verlangt ein Muster darin. Das ist billig, braucht keine Datenbank und eignet
sich, um eine Regel samt Begründung dort festzuhalten, wo sie gilt.

Es hat eine Grenze, die man kennen muss: Eine Quelltext-Prüfung sieht Zeichen,
kein Verhalten. Sie kann grün bleiben, während die Regel nicht mehr wirkt.
Genau das ist passiert — ein Test verlangte einen Ausdruck
(`to_regclass('public.session')`), der auf eine Tabelle zeigte, die es nie gab.
Der Ausdruck stand im Code, der Test war grün, und ein Passwort-Reset beendete
die Sitzung des Angreifers nicht. Der Test hatte die Lücke *festgeschrieben*
statt sie zu finden.

Daraus zwei Regeln für neue Tests:

1. **Sicherheitsregeln brauchen einen Verhaltenstest.** Nicht „das DELETE steht
   im Code", sondern „die Sitzung ist danach wirklich weg" — gegen echte
   Datenbank und echten Store (`test/auth-sessions-db.test.js`,
   `test/household-db.test.js`). Die Quelltext-Prüfung darf daneben stehen und
   die Begründung tragen; sie ersetzt den Nachweis nicht.
2. **Keine Namen von Zwischenvariablen festnageln.** Ein Muster wie
   `String(curMain) !== String(curSub)` macht eine folgenlose Umbenennung rot.
   Ein Test, der bei harmlosen Umbenennungen anschlägt, wird beim nächsten
   Refactoring angepasst statt gelesen — und verliert die Warnwirkung, für die
   er da ist. Auf die Struktur zielen, nicht auf die Schreibweise.

Die Gegenprobe für beides ist billig und lohnt sich bei jedem neuen Test:
Regel im Code brechen und schauen, ob er rot wird. Wird er es nicht, prüft er
etwas anderes als gedacht.

- **test/auth-sessions-db.test.js** — Passwortwechsel gegen echten
  connect-pg-simple-Store: Admin-Reset, eigener Wechsel und Bearer-Token. Prüft
  das VERHALTEN (Sitzung danach wirklich weg), nicht den Wortlaut im Code —
  siehe Abschnitt oben.
- **test/api-inventory.test.js** — API-Inventar: parst beide Router-Familien und
  verlangt für JEDEN Endpunkt eine Klassifikation (paritaet / paritaet-schreib /
  paar-extern / nur-v1 / nur-web). Neue Endpunkte ohne Einordnung machen die
  Suite rot — keine API kommt mehr ungeprüft dazu.
- **test/api-parity.test.js** — Paritätstest über alle Lese-Endpunkte: die
  Session-Routen der Webapp (/api/...) und die Token-Routen der Android-App
  (/api/v1/...) müssen für dieselben Daten dieselben Informationen liefern
  (Envelope-Felder wie success/count/page werden ignoriert, der Rest muss
  deep-equal sein). Läuft gegen den echten Stack (beide Router-Familien,
  gemeinsame Handler, echte DB, echte Auth-Middlewares — nur die Session wird
  injiziert) und prüft zusätzlich den Bearer-Token-Pfad der Android-App
  end-to-end. Enthält zudem Schreib-Paritäten (PUT Set, PUT Erfassung,
  DELETE Set über beide Familien -> gleicher DB-Effekt). Gleiche
  DB-Voraussetzung wie catalog-api.
- **test/catalog-api.test.js** — Integrationstest der /api/v1/catalog-Endpunkte gegen
  echtes PostgreSQL (nur Auth gestubbt). Braucht eine Test-DB (Inhalt wird geleert!):
  `TEST_DATABASE_URL`, Default `postgres://tester:test@localhost/cattest`.
  Ohne erreichbare DB wird die Suite übersprungen, nicht rot.
- **test/catalog-frontend.test.js** — jsdom-Test des Katalog-Frontends
  (Von-Bis-Slider, Filter, Debounce, Platzhalter, Reset) gegen ein Mini-Backend.
- **test/dom-ids.test.js** — jede statisch per `G('...')` referenzierte ID muss in
  index.html oder einem JS-Template existieren.
- **test/i18n.test.js** — DE/EN-Schlüsselparität und Platzhalter-Konsistenz.
