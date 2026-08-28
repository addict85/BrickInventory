# Upgrade-Hinweise

Diese Fassung ändert an drei Stellen etwas, das beim Deployment auffällt.
Alles andere ist abwärtskompatibel.

## 1. Der Startbefehl hat sich geändert

Die transpilierten `.js`-Dateien lagen bisher neben ihren `.ts`-Quellen im Repo.
Sie sind entfernt; der Build schreibt nach `dist/`.

```
npm ci
npm run build      # → dist/ + public/js/app.bundle.js
npm start          # → node dist/server.js
```

`npm run dev` (tsx) baut das Frontend-Bündel vorher selbst und braucht kein
`npm run build`. Der Docker-Build macht beides; dort ändert sich nichts an der
Bedienung.

**Nach jeder Änderung an `public/js/*` oder `public/i18n.js`** muss
`npm run build:frontend` laufen — sonst liefert der Server das alte Bündel aus.

## 2. Neue Umgebungsvariablen (alle optional)

| Variable | Wirkung |
|---|---|
| `APP_BASE_URL` | Basis-URL für Links in Mails. **Sollte gesetzt werden** — ohne sie stammt der Host aus dem Request-Header. |
| `ADMIN_PASSWORD` | Passwort des beim ersten Start angelegten Admins. Ohne die Variable wird ein Zufallspasswort erzeugt und einmalig ins Log geschrieben. |
| `REQUIRE_DB=1` | Nur für CI: Tests dürfen sich nicht mehr überspringen, wenn keine Datenbank erreichbar ist. |

`PG_POOL_MAX` ist aus Dockerfile und compose.yaml **entfernt**. Die App rechnet
`min(15, 80 / Anzahl Worker)` jetzt selbst aus. Nur setzen, wenn die
Postgres-Instanz ein abweichendes `max_connections` hat.

## 3. Bestehende API-Tokens im Klartext werden gelöscht

`validateToken()` hatte einen Legacy-Pfad, der Tokens auch im Klartext suchte.
Der ist entfernt (er hielt die ungehashte Speicherung dauerhaft gültig).
Beim ersten Start nach dem Update werden Klartext-Zeilen aus `api_tokens`
entfernt — erkennbar am Format, gehashte Tokens sind immer 64 Hex-Zeichen.

**Betroffen ist nur, wer noch ein Token aus der Zeit vor dem Hashing benutzt.**
In dem Fall: In den Einstellungen ein neues erzeugen und in der Android-App
hinterlegen. Reguläre Anmeldungen sind nicht betroffen.

Zusätzlich: Ein Passwortwechsel oder ein Reset verwirft ab sofort **alle**
Tokens und Sessions des Kontos. Das ist beabsichtigt — bisher überlebte ein
Bearer-Token mit sieben Tagen Restlaufzeit jeden Passwortwechsel.

## 4. Einstellungsseite: API-Schlüssel werden maskiert

`GET /api/settings/` lieferte die komplette `global_settings`-Tabelle an jedes
angemeldete Konto aus — inklusive BrickLink-Secrets, API-Schlüsseln und
SMTP-Passwort. Jetzt: Nicht-Admins sehen diese Felder gar nicht, Admins sehen
sie maskiert (`••••••••••••` + letzte vier Zeichen).

Beim Speichern wird eine unveränderte Maske ignoriert, ein Feld muss also nur
angefasst werden, wenn der Wert wirklich neu ist. `GET /api/settings/export`
enthält die Schlüssel nicht mehr — beim Wiederherstellen einmalig neu eintragen.

## 5. Sicherung

Neu: `scripts/backup.sh` (pg_dump im laufenden Betrieb + `data/` als Tar).
Ein Dateikopie-Backup von `pgdata/` bei laufendem Postgres ist wertlos.
Den Restore-Weg einmal ausprobieren, bevor er gebraucht wird — die Befehle
stehen am Ende des Skripts.

## 6. Bilder liegen jetzt unter `data/images/`

Set-Bilder wurden nach `public/images/sets/` geschrieben — also in den Baum, der
im Docker-Image aus dem Build-Stage kommt und **nicht** im gemounteten Volume
liegt. Nach jedem Rebuild waren sie weg und wurden einzeln neu vom CDN geholt;
eine Sicherung von `data/` erfasste sie nie.

**Der Web-Pfad bleibt `/images/…`.** In der Datenbank stehen tausende
`image_local`-Werte mit diesem Präfix, und die Android-App baut ihre Bild-URLs
daraus — beides bleibt unverändert. Es ändert sich nur, welches Verzeichnis
dahinter liegt.

Beim ersten Start nach dem Update verschiebt `utils/migrateImages.ts` die
vorhandenen Dateien einmalig von `public/images/` nach `data/images/`
(idempotent, Fehler einzelner Dateien brechen nichts ab). Im Log erscheint:

```
[img-migrate] Bilder nach data/images/ verschoben: 1234 verschoben, 0 bereits vorhanden, 0 fehlgeschlagen
```

Läuft die Instanz per Compose, war `public/images/sets` bisher kein Volume — die
Altbestände im laufenden Container werden beim Rebuild ohnehin verworfen. Dann
passiert bei der Migration nichts, und die Bilder werden ein letztes Mal neu
geladen. Danach überleben sie jeden Rebuild.

## 7. PostgreSQL 18

`compose.yaml` verweist jetzt auf `postgres:18-alpine`. **Ein blosser Tausch des
Tags funktioniert nicht** — die genauen Schritte stehen unten in dieser Datei
unter „PostgreSQL 16 → 18".

## 6. Übersetzungen liegen jetzt in eigenen Dateien

`public/i18n.js` enthielt beide Wörterbücher (~60 KB), die vollständig ins
Frontend-Bündel wanderten — jeder Nutzer lud dauerhaft die Sprache mit, die er
nie sieht. Sie liegen jetzt in `public/locales/de.js` und `public/locales/en.js`.

`index.html` bindet nur die aktive Sprache ein; welche das ist, entscheidet der
Server anhand der gespeicherten Nutzersprache (`utils/indexHtml.ts`) — genauso
wie beim Design. Ein Sprachwechsel lädt die zweite Datei zur Laufzeit nach.

**Für dich heisst das:** Neue Übersetzungsschlüssel gehören in `public/locales/`,
nicht mehr in `i18n.js`. Danach `npm run build:frontend`. Der Test
`i18n-duplicates.test.js` prüft weiterhin, dass DE und EN denselben
Schlüsselvorrat haben.

Bündelgrösse dadurch: **218 KB → 169 KB**.

## 7. Barrierefreiheit

Vorher stand in 83 KB `index.html` genau ein `aria`-Attribut, kein `role=`, und
**kein einziges** der 59 `<label>` war mit seinem Feld verknüpft (Muster:
`<label>Text</label><input id="x">` — nebeneinander, aber ohne `for=`). Für
einen Screenreader sind diese Felder unbeschriftet, und ein Klick auf die
Beschriftung setzt den Fokus nicht ins Feld.

Jetzt: 57 Labels verknüpft, 19 Bedienelemente mit übersetzbarem `aria-label`,
Suchfelder beschriftet (ein `placeholder` ist kein Label — er verschwindet beim
Tippen), sieben modale Overlays mit `role="dialog"` und `aria-modal`.

`test/a11y.test.js` hält das fest. Wer ein neues Formularfeld einbaut, bekommt
einen roten Test, wenn die Beschriftung fehlt.

## 6. Frontend läuft jetzt auf ES-Modulen

`public/js/*.js` und `public/i18n.js` sind echte Module mit `import`/`export`.
Für den Betrieb ändert sich nichts — das Bündel wird weiterhin als klassisches
Skript ausgeliefert (`format=iife`). Beim Entwickeln gilt:

- **Neue Datei unter `public/js/`?** Sie muss in `js/main.js` importiert werden,
  sonst wird sie nie ausgeliefert. `npm run build:frontend` bricht mit einem
  Hinweis ab, wenn eine Datei im Graphen fehlt.
- **Neuer Handler für `data-click="…"`?** Er muss am Ende seines Moduls über
  `registerActions({ … })` angemeldet werden. Der Dispatcher löst nicht mehr
  über `window[name]` auf (das ging nur, solange alles global war).
  `test/csp-actions.test.js` und `test/bundle-smoke.test.js` melden eine
  fehlende Anmeldung, bevor sie jemandem im Browser auffällt.
- **Etwas beim Start ausführen?** Nicht in den Modulrumpf schreiben, sondern in
  `startApp()` in `js/08-init.js`. Bei gegenseitigen Importen läuft der
  Modulrumpf, bevor andere Module ausgewertet sind.

Nach jeder Änderung an `public/js/` oder `public/i18n.js`:
`npm run build:frontend` (macht `npm run dev` und der Docker-Build von selbst).

Das Bündel ist durch Tree-Shaking von 218 KB auf **148 KB** geschrumpft.

## 7. Build ist deutlich schneller — und `npm ci` ist Pflicht

**Vor dem ersten `npm test` unbedingt `npm ci` ausführen.** Ohne installierte
Abhängigkeiten fehlen `express`, `jsdom`, `pg` und `tsc`, und die Build-Skripte
ziehen esbuild bei jedem Aufruf per npx aus dem Netz.

Behoben in dieser Fassung:

- `scripts/build-ts.js` startet esbuild **einmal** für alle 58 Dateien statt
  einmal je Datei (`--outbase` + `--outdir` erhalten die Verzeichnisstruktur).
- Beide Build-Skripte und der Dockerfile benutzen `node_modules/.bin/esbuild`
  statt `npx`; npx bleibt nur als Rückfall ohne Installation.
- Die Tests bauen `dist/` nicht mehr neu, wenn es aktueller ist als die
  Quellen. Vorher tat das **jede** der neun betroffenen Testdateien einzeln —
  jede läuft in einem eigenen Prozess.

Gemessen: Gesamtsuite von rund **9,5 Minuten auf 14 Sekunden**; auf schwächerer
Hardware (Raspberry Pi) liefen vorher neun Testdateien in die 60-Sekunden-Grenze
und wurden als `cancelled` gemeldet — inhaltlich war nie etwas falsch.

`test/build-tooling.test.js` hält das fest, inklusive der Prüfung, dass die
npx-Rückfallversion mit `package.json` übereinstimmt.

## 8. Sicherheitsupdates der Abhängigkeiten

`npm audit` meldete vier Funde (drei hoch, einer mittel) — jetzt **null**:

| Paket | Was |
|---|---|
| `nodemailer` 6 → 9.0.5 | Acht Advisories, darunter SMTP-Command-Injection und CRLF-Injection in Kopfzeilen. Die App nutzt nur `createTransport` und `sendMail` — beide über die Hauptversionen unverändert, gegengeprüft. |
| `esbuild` 0.21.5 → 0.25.12 | Betraf nur den Entwicklungs-Server, den wir nicht benutzen; trotzdem gehoben, damit `npm audit` in CI aussagekräftig bleibt. |
| `undici`, `brace-expansion` | Transitiv, über `npm audit fix` ohne Bruch. |

Das Laufzeit-Image enthält jetzt **keine** devDependencies mehr: Das Build-Stage
installiert vollständig (es braucht esbuild), das Runtime-Stage macht ein eigenes
`npm ci --omit=dev`, statt `node_modules` aus dem Builder zu übernehmen.

## 9. Docker-Build: eine Installation statt zwei

Der Versuch aus Fassung 64, im Runtime-Stage ein eigenes `npm ci --omit=dev`
laufen zu lassen, war falsch — der Build brach mit
`Cannot find module '/app/scripts/bump-version.js'` ab: `npm ci` löst den
postinstall-Hook aus, und `scripts/` wird in dieses Stage nie kopiert.

Jetzt: Das Build-Stage installiert einmal vollständig (es braucht esbuild),
räumt nach den Build-Schritten per `npm prune --omit=dev --ignore-scripts` auf,
und das Runtime-Stage übernimmt den bereinigten Baum. Damit entfällt der zweite
Registry-Durchlauf — auf schwacher Hardware rund 45 Sekunden Bauzeit.

Geprüft: Alle dreizehn Laufzeit-Abhängigkeiten laden nach dem Prune,
esbuild/jsdom sind weg. `test/build-tooling.test.js` hält beides fest, inklusive
der Regel, dass prune erst NACH dem Frontend-Build stehen darf.

## 10. Der Ordner `./images` entfällt

`compose.yaml` mountete bisher zusätzlich `./images:/app/public/images/sets`.
Das war der alte Ablageort für Set-Bilder. Der Code schreibt seit dem Umbau auf
`utils/appPaths.ts` nach `data/images/` — die Zeile blieb nur stehen und
erzeugte den Ordner `./images` neben `./data`.

**Vorschaubilder liegen übrigens nicht in einem eigenen Unterordner.** Sie
stehen als `<name>_thumb.jpg` direkt neben dem Original:

```
data/images/sets/75192-1.jpg
data/images/sets/75192-1_thumb.jpg
data/part_images/3001_4.png
data/part_images/3001_4_thumb.jpg
```

Ein `data/images/thumbs/` gibt es nicht und gab es nie.

### Vor dem Update prüfen

```bash
cd /pfad/zu/brickinventory
ls -la ./images/sets/ 2>/dev/null | head
```

**Ist der Ordner leer oder nicht vorhanden:** nichts zu tun. Die einmalige
Migration (`utils/migrateImages.ts`) hat beim letzten Start bereits alles nach
`data/images/sets/` verschoben. `./images` kann weg.

**Liegen dort noch Dateien:** einmal von Hand herüberholen, bevor die
Volume-Zeile verschwindet — sonst sieht der Container sie nicht mehr:

```bash
docker compose down
mkdir -p ./data/images/sets
# -n: vorhandene Dateien in data/ sind im Zweifel die neueren
cp -rn ./images/sets/. ./data/images/sets/
docker compose up -d
```

Wenn die Galerie danach ein paar Tage sauber läuft:

```bash
rm -rf ./images
```

Fehlt doch einmal ein Bild, ist nichts verloren — der Hintergrundlauf holt es
beim nächsten Anzeigen erneut vom CDN.

### Eigene Pfade

Wer die Volumes selbst setzt, braucht jetzt nur noch eines:

```yaml
volumes:
  - /mnt/data:/app/data   # enthält Bilder, Uploads, Anleitungen, Caches
```

## 11. Neue Ordnung unter `data/`

```
VORHER                            NACHHER
data/part_images/    (gemischt)   data/images/parts/
                                  data/images/minifigs/
data/images/sets/                 data/images/sets/       (unverändert)
data/instructions/shared/         data/instructions/
```

`part_images` enthielt auch die **Minifiguren-Bilder** — der Bild-Hintergrundlauf
rief für Figuren dieselbe `downloadImage()`-Funktion auf. Der Name stimmte also
für die Hälfte des Inhalts nicht.

`instructions/shared/` war der einzige Unterordner von `instructions/`. Er sollte
gegen benutzereigene Anleitungen abgrenzen — die liegen aber unter
`data/uploads/<benutzer-id>/` und waren nie dort.

### Der Umzug ist erledigt und der Code dafür entfernt

Der einmalige Umzug bestand aus zwei Teilen: `db/migrations/0002` schrieb die
Pfade in der Datenbank um (**je Tabelle**, weil nur die Tabelle verrät, ob
`3001_4.png` ein Teil oder eine Figur ist), und `utils/migrateLayout.ts`
verschob die Dateien anhand dieser Werte.

Beides ist ab Fassung 73 **entfernt**, nachdem der Umzug durchgelaufen war. Der
Eintrag in `schema_migrations` bleibt bestehen und stört nicht.

**Wer noch nicht migriert hat, darf nicht direkt auf 73 springen** — sonst
bleiben die Dateien in `data/part_images/` und `data/instructions/shared/`
liegen, während die Datenbank auf die neuen Pfade zeigt. Prüfen mit:

```bash
ls data/part_images/ data/instructions/shared/ 2>/dev/null | head
```

Ist beides leer oder nicht vorhanden, ist der Umzug durch. Andernfalls zuerst
Fassung 72 einspielen, den Start abwarten (Log: `[layout-migrate] …`) und erst
danach auf 73 gehen.

### Alte Adressen sind NICHT mehr erreichbar

`/data/part_images/…` und `/data/instructions/shared/…` gibt es nicht mehr —
bewusst ohne Weiterleitung. Beide Clients kommen aus derselben Hand und werden
gemeinsam aktualisiert; eine Weiterleitung, die niemand braucht, hält nur den
alten Pfad am Leben und verdeckt beim Testen, wenn irgendwo doch noch der alte
Wert entsteht.

Praktisch heisst das: **Server und Android-App zusammen ausrollen.** Eine App
mit zwischengespeicherter Liste zeigt bis zum nächsten Laden leere Kacheln.
Wer sichergehen will, meldet sich in der App einmal ab und wieder an — das
leert Daten- und Bildcache.

### Was gleich bleibt

Teile- und Figurenbilder verlangen weiterhin eine **Anmeldung** und behalten die
Heilfunktion: Fehlt die lokale Datei, wird die CDN-Adresse aus dem Katalog
gesucht und über den Bild-Proxy ausgeliefert. Sie laufen deshalb über eine
eigene Route, die **vor** dem statischen `/images`-Mount registriert ist — ein
schlichter Umzug in den Mount hätte beides stillschweigend entfernt.

Nebenbei behoben: Die Heilfunktion durchsuchte die Tabelle `minifigs` nicht.
Ein fehlendes Bild einer manuell erfassten Figur war dadurch nicht reparierbar.

## 12. Alle Bilder verlangen jetzt eine Anmeldung

Set-Bilder liefen bisher über `express.static` — also **ohne** jede Prüfung.
Die Begründung im Code lautete, es seien öffentliche Katalogfotos.

Für das einzelne Bild stimmt das. Für die Sammlung nicht: Wer die Adressen
durchprobiert, liest ab, **welche Sets jemand besitzt**. Der Bestand ist das
Schützenswerte, nicht das Foto. Teile- und Minifiguren-Bilder verlangten schon
immer eine Anmeldung — die Ungleichbehandlung war historisch, nicht begründet.

Jetzt deckt eine einzige authentifizierte Route den gesamten Baum unter
`data/images/` ab (Sets, Teile, Minifiguren), inklusive der Heilfunktion bei
fehlender lokaler Datei. Die Antworten tragen `Cache-Control: private`, damit
ein Reverse-Proxy sie nicht an Dritte weiterreicht.

**Der Platzhalter ist umgezogen**: `/images/set-placeholder.svg` →
`/assets/set-placeholder.svg`. Er ist ein Build-Asset wie CSS und JavaScript
und hätte die Regel „alles unter `/images/` verlangt Anmeldung" sonst
durchlöchert.

Bereits geschützt und unverändert: PDF-Export
(`/api/v1/sets/partslist-pdf/download/:jobId`, `requireToken`), Anleitungen
(`/data/instructions/*`), Uploads (`/data/uploads/*`) und der Bild-Proxy.

> **Die Android-App braucht dafür eine Anpassung.** Coil-Bildanfragen an
> `/images/…` bekommen ohne `Authorization`-Header ab sofort eine 401.
> Siehe den Abschnitt am Ende dieser Datei bzw. den separaten Änderungsauftrag.
