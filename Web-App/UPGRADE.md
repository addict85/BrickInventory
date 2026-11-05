# Upgrade-Hinweise

Die Abschnitte stehen in der Reihenfolge, in der die Änderungen kamen; ein
Update über mehrere Fassungen geht sie der Reihe nach durch. Wie eine
Installation heute aussieht, steht in `README.md` („Docker“). Wo ein älterer
Abschnitt dem heutigen Verhalten widerspricht, steht dort
**„Überholt durch Abschnitt N“**; der alte Text bleibt als Beleg stehen.

Die ersten Abschnitte (1–7) gehören zu einer Fassung, die an drei Stellen
etwas änderte, das beim Deployment auffiel.

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
| `APP_BASE_URL` | Basis-URL für Links in Mails. **Sollte gesetzt werden** — ohne sie stammt der Host aus dem Request-Header. **Überholt durch Abschnitt 25 und 38:** Der Host kommt nie aus dem Request; ohne `APP_BASE_URL` startet der Web-Prozess im Betrieb nicht. |
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

> **Überholt durch Abschnitt 11:** Der Umzug ist erledigt, der Code dafür
> (`utils/migrateImages.ts`) entfernt.

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
Server anhand der gespeicherten Nutzersprache (`src/konto/indexHtml.ts`) — genauso
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
`src/infra/appPaths.ts` nach `data/images/` — die Zeile blieb nur stehen und
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

## 13. Datenbankpasswort, TRUST_PROXY und verschlüsselte Gutscheine

> **Überholt durch Abschnitt 33:** Das Datenbankpasswort steht nicht mehr in
> `.env`, sondern in `./geheimnisse/db_password`.

- **`DB_PASSWORD` ist Pflicht.** `compose.yaml` hat keinen Ersatzwert mehr, und
  mit dem alten Beispielpasswort `brickinventory_secret` verweigert der Server
  in Produktion den Start. Bestehende Datenbank umstellen:
  ```
  docker compose exec postgres psql -U brickinventory -c "ALTER USER brickinventory PASSWORD 'neues-passwort'"
  echo DB_PASSWORD=neues-passwort >> .env
  docker compose up -d
  ```
- **`TRUST_PROXY=docker` gibt es nicht mehr.** Erlaubt sind nur feste Adressen
  oder kleine Netze; ohne Angabe gilt Loopback. Ein Reverse-Proxy im
  Compose-Netz bekommt eine feste Adresse (`ipv4_address: 172.28.73.10`) und
  genau diese kommt in `.env`. Das Netz `brickinventory-net` hat dafür jetzt
  das feste Subnetz `172.28.73.0/24`; bei einer Fehlermeldung zum Netz einmal
  `docker compose down` und wieder `up -d`.
- **Gutschein-PDFs** unter `data/vouchers/` werden beim ersten Start einmalig
  mit dem Datenschlüssel (`data/.datenschluessel` oder `DATA_KEY`) verschlüsselt.
  Eine Sicherung von `data/` ohne diesen Schlüssel kann sie nicht mehr lesen.
- **Konto löschen** entfernt jetzt auch `data/uploads/<id>/` und
  `data/vouchers/<id>/`. Verwaiste Ordner früher gelöschter Konten bitte von
  Hand entfernen.

## 14. HTTPS mit Caddy, Token-Scopes und Passkeys

Die App ist nach aussen nur noch über **Caddy** (HTTPS) erreichbar; Port 3000
wird nicht mehr veröffentlicht.

### Umstieg

1. In `.env` den Namen oder die IP-Adresse des Servers eintragen:
   ```
   echo BRICK_HOST=nas.example.lan >> .env
   ```
   Ohne `APP_BASE_URL` gilt `https://BRICK_HOST`. Wer `APP_BASE_URL` gesetzt
   hat, stellt sie auf `https://…` um (bisher meist `http://…:3000`).
2. Hatte `.env` `TRUST_PROXY` leer oder `APP_BIND` gesetzt: beides entfernen.
   Ein eigener Reverse-Proxy auf einem anderen Rechner bleibt möglich — dann
   `TRUST_PROXY` auf dessen Adresse und den Dienst `caddy` weglassen.
3. `docker compose up -d --build`. Caddy legt beim ersten Start seine CA unter
   `./caddy/data/` an (Wurzel 10 Jahre gültig). Port 443 und 80 müssen frei sein.
   **Überholt durch Abschnitt 32 und 33:** Caddy startet nur noch mit der
   eigenen, auf `BRICK_HOST` beschränkten CA (`scripts/ca-einrichten.sh`),
   mit `BRICK_TLS=acme` oder ausdrücklich `CA_OHNE_NAMENSBESCHRAENKUNG=ja`.
4. Das Wurzelzertifikat auf die Geräte bringen (unten).
5. Die Android-App einmal neu verknüpfen (QR-Code): Erst dann kennt sie den
   Fingerabdruck und die https-Adresse. Bis dahin meldet sie sich mit dem
   alten Token über `http://…:3000` an — die Adresse gibt es nicht mehr.

`./caddy/` gehört in die Sicherung: Geht die CA verloren, legt Caddy eine neue
an, und jedes Gerät braucht das neue Wurzelzertifikat und die App einen neuen
QR-Code.

### Das Wurzelzertifikat auf Geräte bringen

Caddy legt es unter `./caddy/data/caddy/pki/authorities/local/root.crt` ab.
Die Web-App bietet es unter `https://<BRICK_HOST>/ca.crt` an — auch über
`http://<BRICK_HOST>/ca.crt`, weil ein Gerät es braucht, bevor es HTTPS
vertraut. Vor dem Installieren den Fingerabdruck vergleichen; auf dem Server:

```
openssl x509 -in caddy/data/caddy/pki/authorities/local/root.crt -pubkey -noout \
  | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64
```

Derselbe Wert steht in der Web-App unter Einstellungen → Sicherheit
(„Server-Zertifikat“) und als `fp` im QR-Code der App.

- **Windows:** Datei öffnen → „Zertifikat installieren“ → „Lokaler Computer“
  → „Vertrauenswürdige Stammzertifizierungsstellen“.
- **macOS:** Datei öffnen (Schlüsselbundverwaltung, System) → Zertifikat
  doppelklicken → „Vertrauen: Immer vertrauen“.
- **Linux:** `sudo cp brickinventory-ca.crt /usr/local/share/ca-certificates/ && sudo update-ca-certificates`;
  Firefox hat einen eigenen Speicher (Einstellungen → Zertifikate → Importieren).
- **Android:** Einstellungen → Sicherheit → Verschlüsselung & Anmeldedaten →
  Zertifikat installieren → CA-Zertifikat. Für die BrickInventory-App nicht
  nötig, nur für den Browser: Die App pinnt den Fingerabdruck aus dem QR-Code
  (`fp`) und braucht keine systemweite Installation. Eine im System
  installierte Wurzel gilt für jede Adresse — wer nur die App nutzt, lässt sie
  besser weg.
- **iOS/iPadOS:** Datei in Safari laden → Einstellungen → Profil installieren;
  danach Allgemein → Info → Zertifikatsvertrauenseinstellungen → einschalten.

Das Wurzelzertifikat gilt auf dem Gerät für **jede** Adresse. Der Schlüssel
dazu liegt nur in `./caddy/data/` (nur für root lesbar) — dieses Verzeichnis
wie ein Passwort behandeln.

### Tokens

- Bestehende Tokens behalten ihre Rechte (Scope `voll`), laufen aber spätestens
  **90 Tage nach dem Update** ab, wenn sie nicht benutzt werden; jede Nutzung
  schiebt die Frist nach. Auch bisher „unbegrenzte“ Tokens bekommen diese Frist.
- Neue Tokens haben ohne ausdrücklichen Wunsch Scope `app`: keine
  Verwalterrechte, auch nicht für ein Verwalterkonto. QR-Codes geben immer
  `app`. Verwalterfunktionen der App brauchen eine Anmeldung mit Passwort und
  `scope: "voll"`.
- `TOKEN_IDLE_DAYS=0` gibt es nicht mehr (Startfehler). „Unbegrenzt“ gibt es
  nur beim QR-Code, nur über HTTPS, und der Token muss alle 60 Tage getauscht
  werden (die App tut das selbst).
- Die Geräteliste (Einstellungen → Konto) zeigt Scope, letzte Nutzung,
  Adressbereich und Ablauf; jeder Eintrag ist einzeln widerrufbar.

### Passkeys

Passkeys lassen sich im Konto einrichten und auf der Anmeldeseite ohne
Passwort benutzen; mit eingeschaltetem zweitem Faktor ersetzen sie den Code.
Sie brauchen HTTPS und einen **Namen** in `APP_BASE_URL` (keine IP-Adresse);
wechselt der Name, gelten die bisherigen Passkeys nicht mehr.

## 15. Ein Web- und ein Job-Prozess; Hintergrundarbeit als Aufträge

**Was sich ändert**

- Der Server startet keinen Cluster mehr (ein Worker je Kern, Primärwahl über
  eine Datenbanksperre). Stattdessen gibt es **zwei Rollen**, gewählt mit
  `ROLLE`: `web` beantwortet Anfragen, `jobs` arbeitet die Hintergrundarbeit
  ab, `beides` (Vorgabe) tut beides in einem Prozess.
- `compose.yaml` startet dafür den Dienst `app` mit `ROLLE: web` und einen
  neuen Dienst **`jobs`** aus demselben Bau mit `ROLLE: jobs`. Beide hängen
  `./data` ein; der Dienst `jobs` hat keinen Port.
- **Alle Hintergrundarbeit steht als Auftrag in der Tabelle `auftraege`**:
  Preise, Anleitungen, Brickset-Wiedervorlage, Bilder, PDF, CSV-Import,
  Katalogabgleich, Aufräumen. Zeitpläne (täglich 03:00 Katalog, Preise im
  eingestellten Intervall, stündliches und tägliches Aufräumen) sind
  geplante Aufträge mit einem Termin. Die Verwaltung zeigt sie unter
  „Monitoring → Hintergrundarbeiten“ mit Abbrechen, Wiederholen, Jetzt und
  Leeren.
- `WEB_WORKERS` wird nicht mehr ausgewertet. Steht es noch in der eigenen
  `compose.yaml`, meldet der Start einen Hinweis; die Zeile kann weg.

**Was beim Update geschieht**

- Migration 0082 erweitert `auftraege` (Spalten `faellig_ab`, `frist_bis`,
  `gestartet`, `fortschritt`, Status `abgebrochen`) und legt
  `auftrag_pausen` an.
- Migration 0083 übernimmt die alten Warteschlangen und entfernt sie:
  - `instruction_queue` → Aufträge `anleitung` (wartende, erledigte und
    gescheiterte);
  - `brickset_retry_queue` → Aufträge `brickset`, fällig um 04:00 des
    vorgemerkten Tages, Versuchszähler übernommen;
  - `pdf_auftraege` → der Status steht im PDF-Auftrag; ein PDF, das während
    des Updates lief, endet als Fehler und wird neu angefordert;
  - `csv_import_jobs` heisst jetzt `import_stand` (Importstand je Konto,
    keine Warteschlange).
  `image_wanted` bleibt: Es ist der Bildbedarf (Daten), abgearbeitet von
  einem einzigen Auftrag `bildbedarf`.
- Migriert wird wie bisher nur einmal unter einer Datenbanksperre: Starten
  `app` und `jobs` gleichzeitig, wartet der zweite.

**Was zu tun ist**

1. Eine eigene `compose.yaml` mit der neuen vergleichen und den Dienst `jobs`
   übernehmen. Was beim Dienst `app` zusätzlich gesetzt ist (`DATA_KEY`, `TZ`,
   `ERFASSUNG_ZEITZONE`, `PG_*`, `IMG_USER_AGENT`, `APP_BASE_URL`), gehört beim
   Dienst `jobs` genauso hin — sonst entschlüsselt er die gespeicherten API-Schlüssel nicht
   oder rechnet in einer anderen Zeitzone.
2. `docker compose up -d --build`. Danach unter „Monitoring“ prüfen, dass
   keine Warnung „Kein Job-Prozess meldet sich“ steht.
3. Wer bewusst nur einen Container betreiben will, lässt `jobs` weg und setzt
   bei `app` `ROLLE: beides` (oder lässt `ROLLE` ganz weg).

**Zurück auf die alte Fassung**

Die alten Tabellen sind nach Migration 0083 entfernt. Eine Rückkehr geht nur
über die Sicherung, die der Server vor offenen Migrationen anlegt
(Abschnitt 5).

## 16. Mailserver: Zertifikat immer geprüft

Die Einstellung „Zertifikat des Mailservers nicht prüfen“ (`smtp_insecure_tls`)
entfällt; die Verbindung zum Mailserver wird immer geprüft. Wer sie gesetzt
hatte, sieht beim Start eine Warnung im Log und unter Einstellungen → E-Mail
einen Hinweis. Ohne Eintrag schlägt der Versand an einen Server mit selbst
signiertem Zertifikat mit einer Meldung fehl, die sagt, was fehlt.

- **Zertifikat (PEM)**: das selbst signierte Zertifikat des Mailservers oder
  seine eigene CA. Es ersetzt für SMTP die Liste der öffentlichen CAs.
- **SHA-256-Fingerabdruck** (optional): nagelt genau ein Zertifikat fest; bei
  Abweichung bricht der Versand ab. Mit Fingerabdruck entfällt der Abgleich
  des Hostnamens, etwa wenn der Server über seine IP erreicht wird. Nach einem
  Zertifikatswechsel ist er neu einzutragen.

Abrufen lassen sich beide mit

```
openssl s_client -connect mail.example:465 </dev/null 2>/dev/null | openssl x509 > smtp.pem
openssl x509 -in smtp.pem -noout -fingerprint -sha256
```

(für Port 587 zusätzlich `-starttls smtp`). Das Speichern verlangt wie jede
Änderung am Mailserver das Verwalterpasswort.

## 17. Gesundheitsprüfung: `live` und `ready`

- `GET /api/v1/health/live` antwortet `{"status":"ok"}`, solange der Prozess
  läuft — ohne Datenbank.
- `GET /api/v1/health/ready` fragt die Datenbank (`SELECT 1`) und antwortet
  sonst **503** `{"status":"unavailable"}`. Der Healthcheck in `compose.yaml`
  zeigt jetzt hierher; eine eigene Überwachung sollte das auch tun.
- `GET /api/v1/health` liefert ohne Anmeldung nur noch `status`; Startzustand,
  Pool und Laufzeit sieht nur ein Verwalter.

## 18. Sitzungscookie mit `__Host-`-Präfix

- **Nach dem Update sind alle Browser einmal abgemeldet.** Das Sitzungscookie
  heisst nicht mehr `connect.sid`, sondern mit HTTPS `__Host-bim.sid` (nur
  über HTTPS, gilt für die ganze Adresse, keine Subdomain kann es setzen oder
  überschreiben) und ohne HTTPS (`COOKIE_SECURE=0`) `bim.sid`. Ein altes
  `connect.sid` wird nicht mehr gelesen; einfach neu anmelden. Die
  Android-App meldet sich mit Token an und ist nicht betroffen. Wer in einem
  eigenen Proxy oder Monitoring den Namen `connect.sid` verwendet, stellt ihn um.
- Abmelden löscht das Cookie jetzt auch im Browser, statt nur die Sitzung
  in der Datenbank zu beenden.

## 19. Gutscheinnummern verschlüsselt

- **Gutscheinnummern** liegen jetzt wie die PINs verschlüsselt in der
  Datenbank (Migration 0087). Der erste Start schlüsselt den Bestand um, bevor
  er Anfragen annimmt; danach nimmt die Datenbank keine Nummer im Klartext
  mehr an. Doppelte erkennt ein HMAC (`nummer_suche`), dessen Schlüssel aus
  dem Datenschlüssel abgeleitet ist. Ohne `data/.datenschluessel` bzw.
  `DATA_KEY` sind nach einer Wiederherstellung damit auch die Nummern
  verloren — den Schlüssel getrennt sichern (Abschnitt 13, `backup.sh`).
- Die Kopien `vor_migration_*`, die der Start vor Migrationen anlegt,
  enthielten Nummer und PIN im Klartext. Der Start verschlüsselt sie dort
  ebenfalls; mit dem Datenschlüssel bleiben sie lesbar. Sicherungen von vor
  dem Update (`backups/db_*.sql.gz`) enthalten die Nummern weiter im
  Klartext: nach einem geglückten Update löschen oder wie den Schlüssel
  verwahren.

## 20. Mailserver nur noch verschlüsselt (STARTTLS)

Ohne „SSL/TLS" (Port 465) verlangt der Versand jetzt STARTTLS ab TLS 1.2.
Bietet der Mailserver auf Port 25/587 kein STARTTLS an, bricht der Versand
ab, bevor Benutzername und Passwort gesendet werden; Einstellungen → E-Mail →
„Test" sagt das. Abhilfe: Port 465 mit „SSL/TLS" wählen oder STARTTLS am
Mailserver einschalten. Ein Mailserver ohne jede Verschlüsselung wird nicht
mehr unterstützt — Passwort und Rücksetzlinks gingen sonst lesbar durchs Netz.

## 21. Datenschlüssel ausserhalb von `data/`

Der Schlüssel für die verschlüsselten Werte in der Datenbank (API-Schlüssel,
SMTP-Passwort, Gutscheine, zweiter Faktor) lag in `data/.datenschluessel` —
also in jeder Sicherung von `data/` und auf demselben Datenträger wie die
Bilder. `compose.yaml` hängt jetzt `./schluessel` nach `/app/schluessel` ein
und setzt `DATA_KEY_FILE=/app/schluessel/datenschluessel`; eine neue
Installation legt den Schlüssel dort beim ersten Start an.

**Eine bestehende Installation läuft ohne Zutun weiter**: Der Start nimmt
`data/.datenschluessel` und warnt bei jedem Start. Umzug:

```
docker compose down
mkdir -p schluessel
mv data/.datenschluessel schluessel/datenschluessel
docker compose up -d
```

Stehen beide Dateien mit verschiedenem Inhalt da, startet der Server nicht und
nennt beide Pfade — dann die Datei behalten, die vorher in `data/` lag.
`DATA_KEY` geht weiterhin allen Dateien vor. Wer lieber ein Docker-Secret
nimmt, setzt `DATA_KEY_FILE` auf dessen Pfad (z. B. `/run/secrets/datenschluessel`).

`scripts/backup.sh` nimmt den Schlüssel nie ins Archiv; mit
`BACKUP_SCHLUESSEL_ZIEL=/anderer/ort` legt es ihn getrennt dort ab.
`restore.sh` sucht ihn unter `schluessel/` (und noch unter `data/`).

## 22. Geheimnisse an ihren Ort gebunden (Format v2)

Verschlüsselte Werte tragen jetzt das Präfix `v2:` (Gutschein-PDFs: Kopf
`BIENC2`). Neu ist der Kontext: Spalte, Konto und Zeile gehen als zusätzlich
authentifizierte Daten in AES-GCM ein. Ein Geheimtext, den jemand mit
Schreibzugriff auf die Datenbank in ein anderes Konto oder eine andere Zeile
kopiert, lässt sich dort nicht mehr lesen.

- **Der erste Start schlüsselt den Bestand um**, bevor er Anfragen annimmt
  (Migration 0088, dann `startup/datenbank.ts`): API-Schlüssel und
  SMTP-Passwort, TOTP-Geheimnisse, Gutscheinnummern und -PINs (auch in den
  Kopien `vor_migration_*`), gespeicherte Antworten der Idempotency-Keys und
  die Gutschein-PDFs unter `data/vouchers/`. Das Protokoll meldet die Zahl.
- Danach liest der Server nur noch `v2`. Klartext oder `v1`, der später in
  die Tabelle geschrieben wird, gilt als nicht lesbar (Warnung im Protokoll);
  ein Neustart schlüsselt ihn wieder um.
- Eine Sicherung von vor dem Update lässt sich weiter einspielen: Der nächste
  Start schlüsselt sie um. Ohne den Datenschlüssel bleibt sie unlesbar wie
  bisher.

## 23. Der App-Container sieht den Schlüssel der CA nicht mehr

`compose.yaml` hängte Caddys Ordner `pki/authorities/local` samt `root.key` in
die App ein. Jetzt kopiert Caddys Start allein `root.crt` in das Volume
`ca-wurzel` (alle 5 s, nur bei Änderung); die App hängt nur dieses ein und
liest `CA_ZERTIFIKAT=/caddy-ca/root.crt`. Ein Datei-Mount von `root.crt` wäre
kürzer, scheitert aber beim ersten Start: Fehlt die Datei noch, legt Docker an
ihrer Stelle ein Verzeichnis an.

Nichts zu tun ausser die neue `compose.yaml` zu übernehmen und
`docker compose up -d` — die CA in `./caddy/data/` bleibt dieselbe, Geräte und
QR-Codes gelten weiter. Wer `compose.yaml` angepasst hat: Die Zeile
`./caddy/data/caddy/pki/authorities/local:/caddy-ca:ro` bei `app` ersetzen,
`command:` und das Volume bei `caddy` und `volumes: ca-wurzel:` übernehmen.

## 24. Passwortregel und Registrierung

- **Passwörter**: mindestens 8 Zeichen, höchstens 72 Byte (bcrypt las bisher
  nur die ersten 72 und schnitt den Rest still ab; Umlaute zählen doppelt),
  und nicht auf der mitgelieferten Liste häufiger und aus Datenlecks bekannter
  Passwörter (`src/infra/haeufige-passwoerter.txt`, keine Netzabfrage) und
  nicht gleich dem Benutzernamen. Gilt für Registrierung, Ändern,
  Zurücksetzen, Konto anlegen und Passwort setzen durch den Verwalter.
  Bestehende Passwörter bleiben gültig; die Regel greift beim nächsten Setzen.
- **`ADMIN_PASSWORD`** wird beim ersten Start nur übernommen, wenn es die
  Regel erfüllt; sonst legt der Server ein zufälliges Startpasswort an
  (Protokoll), das beim ersten Login zu ändern ist.
- **Registrierung**: Ein schon vergebener Benutzername ergibt dieselbe
  Antwort wie eine erfolgreiche Registrierung; die angegebene Adresse bekommt
  eine Mail „Benutzername schon vergeben". So lässt sich ohne Postfach nicht
  mehr abfragen, welche Konten es gibt.

## 25. Konto und Anmeldung gehärtet

**Vor dem Update prüfen — Benutzernamen**: Migration 0090 legt einen
eindeutigen Index auf `lower(username)`. Gibt es zwei Konten, deren Namen
sich nur in Gross-/Kleinschreibung unterscheiden, bricht der Start mit den
Namen ab; geändert wird nichts. Vorher nachsehen:

```
docker compose exec postgres psql -U brickinventory -c \
  "SELECT lower(username), string_agg(username || ' (id ' || id || ')', ', ')
     FROM users GROUP BY 1 HAVING COUNT(*) > 1"
```

Je Paar eines umbenennen (`UPDATE users SET username = '…' WHERE id = …`),
dann starten.

**`APP_BASE_URL` ist Pflicht für Links in Mails** — auch ausserhalb von
`NODE_ENV=production`. Ohne sie wird die Adresse nicht mehr aus `Host` oder
`X-Forwarded-Host` abgeleitet: Bestätigungs- und Rücksetzmails gehen ohne
Link bzw. gar nicht, der Start warnt. `compose.yaml` setzt sie schon
(`https://${BRICK_HOST}`). Der Hinweis in §2 („ohne sie stammt der Host aus
dem Request-Header") gilt nicht mehr.

Was sich für Nutzer und Clients ändert:

- **Zweiter Faktor**: Ein neuer Passkey (`POST /auth/passkey/registrieren/optionen`,
  Feld `code`) und das Einlösen einer Haushaltseinladung
  (`POST /settings/household/redeem`, Feld `faktor_code`) verlangen bei
  aktivem TOTP zusätzlich einen Code. Das Bestätigen der TOTP-Einrichtung
  zählt falsche Codes wie jede andere Prüfung (Sperre nach fünf).
- **Wiederherstellungscodes** sind jetzt 16 Zeichen (`xxxx-xxxx-xxxx-xxxx`).
  Bestehende zehnstellige Codes gelten weiter, bis sie verbraucht sind;
  empfohlen ist, im Konto einmal „Neue Codes" zu erzeugen. Codefelder in Web
  und App nehmen 24 Zeichen an.
- **Passwort zurücksetzen** (per Mail) widerruft zusätzlich alle Passkeys.
  Der Passwortwechsel im Profil beendet wie bisher alle Sitzungen und
  Tokens; Passkeys nur, wenn „Auch alle Passkeys entfernen" angekreuzt ist
  (`passkeys_widerrufen: true`).
- **Hinweis-Mails** bei neuem Passkey, Passwortwechsel und -rücksetzung —
  nur mit eingerichtetem Mailserver, ohne Link. Sie nennen die Hauptkonten,
  die die Sammlung sehen.
- **Passwort vergessen**: höchstens ein Link je Konto und 15 Minuten; jede
  Antwort dauert mindestens 400 ms.
- **Startpasswort**: Solange `must_change_password` gesetzt ist, antwortet
  die API ausser auf `change-password` und `logout` mit 403
  `passwort_wechsel_noetig`; die Weboberfläche zeigt dann die Maske zum
  Wechseln. `GET /auth/me` meldet `user.mustChangePassword`.
- **Verwalter legt Konto an**: Ein Name, der sich nur in der Schreibweise
  von einem bestehenden unterscheidet, ergibt 409 `benutzername_vergeben`.
- **„Alle meine Daten löschen"** (`DELETE /api/v1/bestand`) verlangt
  `password`.
- **Protokoll**: Mailadressen erscheinen in `app_logs` nur noch maskiert
  (`m…@example.org`); voll nur mit `MAIL_KONSOLE_MIT_TOKEN=1` (Entwicklung).

## 26. Abrufe nach aussen, Bild-Proxy und Eingabeprüfung

- **Bild-Proxy-Cache neu geschlüsselt**: Bei `cdn.rebrickable.com`,
  `images.brickset.com` und `img.bricklink.com` zählt der Anfrageteil
  (Zeitstempel) nicht mehr. Bestehende Einträge unter `data/img_proxy_cache/`
  werden dadurch einmal neu geholt; die alten fallen nach 30 Tagen oder über
  den Deckel weg. Wer sofort Platz will: Ordner leeren, er füllt sich wieder.
- **Neue Variablen** (`.env.example`):
  `BILD_CACHE_MAX_MB` (Vorgabe 2048) deckelt den Cache, älteste Nutzung zuerst;
  `BILD_ABRUFE_JE_MINUTE` (Vorgabe 240) begrenzt CDN-Abrufe je Konto, darüber
  antwortet der Proxy 429 (Cache-Treffer zählen nicht).
- **Antworten des Bild-Proxys** tragen `Cache-Control: private`; ein geteilter
  Zwischenspeicher vor Caddy hält sie nicht mehr.
- **Eingaben** werden im Betrieb gegen den API-Vertrag geprüft: Ein Feld mit
  falschem Typ, zu langem Text oder ein wiederholter Abfrageparameter ergibt
  400 mit `code: "eingabe_ungueltig"` statt eines 500. Grenzen der Kontofelder:
  Vor-/Nachname 100, E-Mail 254, Benutzername 64 Zeichen.
- **HSTS** setzt der Server nur noch bei `req.secure`, also hinter dem in
  `TRUST_PROXY` genannten Proxy oder bei direktem TLS. Wer ohne
  `NODE_ENV=production` hinter Caddy betreibt, bekommt die Kopfzeile von der
  App nicht mehr (Caddy kann sie selbst setzen).
- **Image**: `.env`, `.env.*` und `backups/` gehören nicht mehr zum
  Build-Kontext; `backups/` steht in `.gitignore`.
- **PDF.js** kommt aus `pdfjs-dist` (exakte Fassung in `package.json`). Nach
  einem Update `npm run build:frontend` laufen lassen; das kopiert die Dateien
  nach `public/vendor/pdfjs/`.

## 27. Runde 4 – Daten: Blickfeld, Mails, Fehlertexte

- **Set-Bilder und Anleitungen nur im eigenen Blickfeld.** `/images/sets/…`
  liefert nur Bilder zu Sets in Bestand, Merkliste oder Preisalarmen des
  eigenen Haushalts aus, `/data/instructions/…` nur Anleitungen zu Sets im
  Bestand; alles andere antwortet 404 wie eine fehlende Datei. Teile- und
  Figurenbilder bleiben für jedes Konto offen. Katalog, `/sets/info` und
  `/sets/barcode` nennen `image_local` für fremde Sets nicht mehr; Web und App
  nehmen dann `image_url` über den Bild-Proxy. An Clients ändert sich nichts.
  Ein Verwalter sieht fremde Set-Bilder ebenfalls nicht mehr über `/images/`.
- **Mails**: Bestätigungs-, Rücksetz- und „Benutzername vergeben“-Mail grüssen
  ohne Namen („Hallo,“). Vor-/Nachname dürfen keine Steuerzeichen und keine
  Webadressen enthalten (400 `name_ungueltig`). Ohne SMTP zeigt die Konsole
  den Link, den der Server erzeugt hat, nicht mehr die erste URL im Text.
- **Neue Drosseln**: Registrierung 3/h und „Passwort vergessen“ 3/h je
  Zieladresse (zusätzlich zu 5/h je IP); Teile-Import 30/h je Konto;
  Währungswechsel 5/h je Konto. Die Zähler stehen wie die übrigen in
  `rate_limit_attempts` (Schlüssel `register-ziel|…`, `forgot-ziel|…`,
  `teile-import|…`, `waehrung|…`; Adressen nur als Hash).
- **Haushaltswährung**: Nur das Hauptkonto ändert sie; ein Unterkonto bekommt
  403 `waehrung_nur_hauptkonto`. Ein Konfig-Import eines Unterkontos mit
  anderer Währung scheitert daran ebenso.
- **Teile-Import** (`POST /api/v1/sets/:setNumber/parts`) nur für Sets im
  Blickfeld (sonst 404 `set_nicht_gefunden`).
- **Fehlertexte**: Erfassungsstrom und CSV-/XML-Importe melden unbekannte
  Fehler als `interner_fehler`; die Einzelheiten stehen im Protokoll
  (`[weiter-trotz-fehler] …`).
- **PDF-Teileliste**: Der Auftrag nimmt jetzt wirklich grössere Listen an
  (bis 4 MB, vorher griff trotz anderslautender Angabe die allgemeine Grenze
  von 256 KB). Ein vorgeschalteter Proxy mit kleinerem `max body` muss für
  `/api/v1/sets/partslist-pdf` mindestens 4 MB erlauben (Caddy begrenzt nicht).

## 28. Runde 4 – Härtung

- **Migration 0091** legt `users.sitzungs_version` an (läuft beim Start von
  selbst). Bestehende Browser-Sitzungen bleiben gültig. Wer Zugänge beendet
  (Passwort setzen/ändern/zurücksetzen, Sperren, Rollenwechsel, Konto löschen,
  „andere Sitzungen beenden“, zweiten Faktor einschalten), erhöht die Version;
  alte Sitzungen des Kontos enden dann sicher, auch wenn eine gleichzeitige
  Anfrage sie zurückschreibt.
- **pgweb verlangt eine Anmeldung**: `PGWEB_PASSWORD` (und optional
  `PGWEB_USER`, Vorgabe `pgweb`) in `.env` setzen, sonst startet
  `docker compose --profile tools up -d pgweb` nicht (Meldung in
  `docker compose logs pgweb`). Der Browser fragt dann nach Benutzer und
  Passwort. Für den normalen Betrieb ohne Profil ändert sich nichts.
- **Zweiter Faktor für heikle Änderungen**: Bei aktivem TOTP verlangen
  `POST /api/v1/auth/change-password`, `DELETE /api/v1/auth/passkeys/:id` und
  `PUT /api/v1/auth/profile` mit neuer E-Mail zusätzlich `code` (TOTP oder
  Wiederherstellungscode). Ohne `code`: 400 `zweiter_faktor_noetig`; falsch:
  400 `zweiter_faktor_falsch`. Die Weboberfläche fragt nach. Ältere Fassungen
  der Android-App können das Passwort eines Kontos mit zweitem Faktor erst
  nach ihrem Update wieder ändern.
- **Verwalter-E-Mail**: Eine neue Adresse des Verwalters gilt erst nach dem
  Bestätigungslink als bestätigt (wie bei allen Konten). Die Anmeldung des
  Verwalters hängt nicht daran.
- **Drosseln je Adresse**: IPv6-Clients aus demselben /64 teilen sich die
  Grenzen (Registrieren, Passwort vergessen, QR-Anmeldung, Anmeldung …) –
  viele Geräte hinter einem IPv6-Anschluss zählen also gemeinsam, wie hinter
  einer IPv4-Adresse.
- **Abrufe nach aussen**: Hosts werden exakt geprüft; Adressen mit eigenem
  Port oder `benutzer@` werden abgelehnt. Unterdomänen sind nur noch für
  `lego.com` erlaubt (Anleitungs-PDFs). Gespeicherte Bildadressen anderer
  Unterdomänen (etwa ein altes `m.rebrickable.com`) lädt der Proxy nicht mehr.
- **Wiederherstellen**: `scripts/restore.sh` prüft das data-Archiv vorher
  (`scripts/archiv-pruefen.sh`): nur Dateien und Ordner unter `data/`, keine
  Verknüpfungen, kein `..`. Archive von `scripts/backup.sh` erfüllen das.
- **Image von Hand bauen** (Workflow `Web-App`, `workflow_dispatch`): Der
  zusätzliche Tag muss die Docker-Tag-Form haben (Buchstaben, Ziffern,
  `_ . -`, höchstens 128 Zeichen), sonst bricht der Lauf ab.

## 29. Runde 5 – Sicherheit

- **Updates der Container-Images**: Dependabot schlägt jetzt auch neue Digests
  für Postgres, Caddy und pgweb in `compose.yaml` vor (wöchentlich). Ein
  solcher PR ist wie ein Update zu behandeln: lesen, mergen, auf dem Server
  `docker compose pull && docker compose up -d`. Der Sicherheitslauf meldet
  zusätzlich, wenn ein festgenagelter Digest hinter seinem Tag zurückliegt.
- **Eigene Datenbankrolle der App (Pflichtschritt)**: Bisher verband sich die
  App als `brickinventory`, und das ist der Superuser der Datenbank (wer die
  App übernimmt, könnte per `COPY … TO PROGRAM` Befehle im Datenbank-Container
  ausführen). Neu verbinden sich App, Jobs und pgweb als `brickinventory_app`
  ohne Superuser-Rechte; die Rolle besitzt Datenbank, Tabellen, Sequenzen,
  Sichten und Funktionen, die Migrationen laufen also weiter. Umstellung:
  1. In `.env` ein zweites, anderes Passwort eintragen:
     `echo "DB_APP_PASSWORD=$(openssl rand -hex 24)" >> .env`
     **Überholt durch Abschnitt 33:** heute `./geheimnisse/db_app_password`
     (`sh scripts/geheimnisse-einrichten.sh`).
     (ohne den Wert bricht `docker compose up` mit einer Meldung ab).
  2. Wie gewohnt aktualisieren: `docker compose up -d --build`. Der neue,
     einmalige Dienst `db-rolle` startet nach der Datenbank, legt die Rolle an
     (oder setzt ihr Passwort und entzieht zu viele Rechte), übergibt ihr alle
     Objekte im Schema `public` und endet; erst danach starten App und Jobs.
     Daten werden dabei nicht verändert, nur Eigentümer.
  3. Prüfen: `docker compose logs db-rolle` endet mit „Rolle brickinventory_app
     ohne Superuser-Rechte besitzt die Datenbank“, und `docker compose logs app`
     zeigt keine Warnung „Die App verbindet sich als Superuser“.

  Neue Installationen bekommen die Rolle schon beim Anlegen der Datenbank
  (`postgres/app-rolle.sh` in `docker-entrypoint-initdb.d`). Sicherungen
  (`scripts/backup.sh`) laufen weiter als Superuser; `scripts/restore.sh`
  richtet nach dem Einspielen `db-rolle` erneut ein, damit auch ein älterer
  Dump wieder der App gehört. Rückweg: die alte `compose.yaml` verbindet sich
  wieder als Superuser und darf alles; die Rolle kann bleiben. Wer
  `DB_APP_PASSWORD` ändert, startet einfach `docker compose up -d` neu.
  Ohne Docker (eigenes PostgreSQL): das Skript einmal mit dem Superuser
  ausführen, z. B. `PGHOST=… PGUSER=postgres PGDATABASE=brickinventory
  DB_APP_PASSWORD=… sh postgres/app-rolle.sh` (psql ab 15), danach die App mit
  `PGUSER=brickinventory_app` starten.
- **Idempotenz ohne Passwörter**: Der Fingerabdruck einer Anfrage mit
  `Idempotency-Key` (24 h in der Tabelle `idempotenz`) war ein SHA-256 über
  den ganzen Rumpf, Passwörter eingeschlossen. Jetzt fehlen Passwort-, Code-,
  PIN-, Token- und Schlüsselfelder darin, und der Rest ist ein HMAC mit einem
  Teilschlüssel des Datenschlüssels. Der erste Start löscht alle Einträge im
  alten Format (Meldung `[idempotenz] … gelöscht`); eine Wiederholung über das
  Update hinweg läuft dann ein zweites Mal statt die alte Antwort zu bekommen.
- **Anleitungen neu laden**: `POST /api/v1/sets/:sn/instructions` ersetzt
  vorhandene geteilte Anleitungen nur noch für Verwalter. Andere Konten holen
  damit nur fehlende (einmal je Set und Tag); sind schon welche da, antwortet
  der Server mit 403 `nur_admins`, und die Weboberfläche zeigt den Knopf
  „Neu laden“ dann nur Verwaltern.
- **PDF-Teileliste**: `POST /api/v1/sets/partslist-pdf` prüft `parts` jetzt
  nach Schema (höchstens 5000 Posten, `quantity` 1–9999, Feldlängen) und
  antwortet sonst mit 400 `eingabe_ungueltig` (Feld in `feld`).
- **Guthaben-Abfrage je Konto begrenzt**: höchstens 20 Abfragen je Konto und
  Stunde, geprüft vor der Grenze für alle (eine je 30 s). Darüber antwortet
  `POST /api/v1/vouchers/:id/guthaben` mit 429, `code: zu_viele_anfragen`,
  `grund: konto` und `wartenSek`; die Weboberfläche bricht den Durchgang über
  alle Karten dann ab wie beim Bot-Schutz.
- **Andere Sitzungen beenden nur mit Passwort**:
  `POST /api/v1/settings/sessions/andere-beenden` verlangt im Rumpf
  `password` (das eigene Passwort). Falsch oder fehlend: 400
  `aktuelles_passwort_falsch`, nach fünf Fehlversuchen 429. Die
  Weboberfläche fragt beim Knopf „Alle anderen abmelden“ danach.
- **Entrypoint**: Die Unterordner von `./data` legt der Container jetzt als
  `brickinv` an, nicht mehr als root. Gehört `./data` einem anderen Nutzer und
  ist `BRICKINV_CHOWN=never` gesetzt (SMB/CIFS), muss die Einhängung dem
  Nutzer `brickinv` des Images gehören; sonst steht im Log eine WARNUNG. Der
  Reparaturschritt (`BRICKINV_CHOWN=auto/always`) ändert nur noch fremde
  Einträge und bleibt im Datenträger.

## 30. Runde 6 – Sicherheit

- **db-rolle gehärtet** (`postgres/app-rolle.sh`): Die App-Rolle besitzt die
  Datenbank und konnte über `ALTER DATABASE … SET search_path` eigene
  Funktionen in die Superuser-Sitzung von `db-rolle` schieben. Das Skript
  setzt jetzt beim Verbinden `search_path=pg_catalog,pg_temp` und
  `role=none`, ruft nur `pg_catalog.`-Funktionen und setzt zuerst
  `ALTER DATABASE brickinventory RESET ALL` sowie
  `ALTER ROLE brickinventory_app [IN DATABASE …] RESET ALL`. **Folge:**
  Eigene Einstellungen per `ALTER DATABASE … SET` oder an der App-Rolle gehen
  bei jedem `docker compose up` verloren; dauerhafte Einstellungen gehören in
  `command:` des Dienstes `postgres` oder an den Superuser. Sind in der
  Datenbank Event-Trigger aktiv, bricht `db-rolle` mit einer Meldung ab
  (vorher prüfen und deaktivieren: `ALTER EVENT TRIGGER … DISABLE`).
  Für eigene `psql`-Sitzungen als Superuser:
  `docker compose exec -e PGOPTIONS='-c search_path=pg_catalog,pg_temp' postgres psql -U brickinventory`.
- **pgweb mit eigener Leserolle**: Neu in `.env`:
  `PGWEB_DB_PASSWORD=$(openssl rand -hex 24)` (anders als `DB_PASSWORD` und
  `DB_APP_PASSWORD`). **Überholt durch Abschnitt 33:** heute
  `./geheimnisse/pgweb_db_password` (`PGWEB=ja sh scripts/geheimnisse-einrichten.sh`). `db-rolle` legt `brickinventory_lesen` an: nur `SELECT`,
  ohne die Tabellen `api_tokens`, `qr_login_tokens`, `user_sessions`,
  `webauthn_challenges`, `zweiter_faktor_codes`, `account_link_invites` und
  ohne die Spalten `users.password_hash/verification_token/reset_token`,
  `zweiter_faktor.geheimnis`, `user_settings.value`, `global_settings.value`,
  `vouchers.pin`, `idempotenz.antwort`. pgweb kennt `DB_APP_PASSWORD` nicht
  mehr; ohne `PGWEB_DB_PASSWORD` startet es nicht. Ein `SELECT *` auf
  `users` scheitert dort deshalb – Spalten einzeln nennen. Reparaturen mit
  `psql` als App-Rolle statt über pgweb. Neue Tabellen sieht pgweb nach dem
  nächsten Lauf von `db-rolle` (`docker compose --profile tools up -d pgweb`
  startet ihn mit).
- **restore.sh spielt als App-Rolle ein**: Erst `db-rolle`, dann der Dump als
  `brickinventory_app` in **einer** Transaktion (`psql -1`; ein Fehler lässt
  den alten Stand stehen), dann noch einmal `db-rolle`. Besitzerzeilen
  (`ALTER … OWNER TO …`) und `DROP/COMMENT ON EXTENSION` werden ausserhalb der
  Daten herausgefiltert; auch Dumps von vor der App-Rolle gehen so. Andere
  App-Rolle: `DB_APP_USER=… ./scripts/restore.sh …`.
- **Anmeldung**: Gesperrte und unbestätigte Konten bekommen dieselbe 401
  `anmeldedaten_ungueltig` wie ein falsches Passwort (vorher 403
  `konto_deaktiviert` / `email_nicht_bestaetigt` mit `unverified: true`).
  Neu: `POST /api/v1/auth/bestaetigung-erneut` `{ email }` schickt einen neuen
  Bestätigungslink (höchstens einer je 15 min, Antwort immer gleich). Die
  Anmeldemaske bietet ihn bei 401 an.
- **Zweiter Faktor**: `DELETE /api/v1/auth/users/:id/zweiter-faktor` lehnt
  das eigene Konto mit 400 `eigener_zweiter_faktor` ab; abschalten geht dort
  unter Sicherheit mit Passwort und Code.
- **Haushaltswährung**: Ein Wechsel gilt nur noch für das eigene Konto und
  seine Unterkonten abwärts. Hängt ein Unterkonto zusätzlich an einem fremden
  Hauptkonto mit anderer Währung, antwortet der Wechsel mit 409
  `waehrung_geteiltes_unterkonto`; erst die Verknüpfung lösen.
- **App-Token mit Höchstdauer**: Ein Token aus `POST /api/v1/auth/login` mit
  `never_expires: true` (die App) trägt jetzt neben der Gleitfrist (90 Tage
  ungenutzt) eine feste Grenze von 180 Tagen ab Anmeldung
  (`hard_expires_at`); `token-rotieren` erbt sie, verlängert sie also nicht.
  Danach meldet sich die App neu an. Bestehende Tokens behalten ihre Fristen;
  QR-Zugänge folgen weiter der beim Erzeugen gewählten Laufzeit. Die Antwort
  des Tauschs nennt in `token_info.expires_at` das frühere der beiden Enden.
- **Abhängigkeiten**: `oauth` und `@types/oauth` entfernt (ungenutzt).
  Renovate schlägt npm- und Gradle-Fassungen erst drei Tage nach Erscheinen
  vor. `npm run build` läuft auch ohne den Ordner `Android-App/`.

## 31. Runde 7 – Sicherheit

Was der Betrieb tun muss, steht zuerst; danach, was sich für Clients ändert.

**Vor dem Update**

- **Datenschlüssel noch in `data/.datenschluessel`?** Dann jetzt nach
  `schluessel/datenschluessel` umziehen (Abschnitt 21): app und jobs hängen
  `./schluessel` ab dieser Fassung **nur lesend** ein und können ihn nicht
  mehr selbst anlegen. Wer schon umgezogen ist, muss nichts tun.

**Beim Update** (`docker compose up -d --build`)

- Neuer Einmal-Dienst **`schluessel`** (läuft vor app und jobs, ohne Netz):
  Er legt `./schluessel/datenschluessel` an, falls er fehlt, und setzt
  Eigentümer `brickinv`, Modus 400, Ordner 700. Im Protokoll:
  `[schluessel] Datenschlüssel vorhanden.` Bei einer Neuinstallation steht dort
  „Neuer Datenschlüssel angelegt“ — diese Datei getrennt von `data/` sichern.
- **Ressourcengrenzen** je Dienst (`mem_limit`, `pids_limit`, `cpus`):
  app und jobs 1 GB, postgres 1 GB/300 Prozesse, caddy 256 MB. Auf einem Gerät
  mit wenig Speicher oder bei sehr grossen Sammlungen in `.env` anpassen:
  `APP_MEM_LIMIT`, `JOBS_MEM_LIMIT`, `DB_MEM_LIMIT`, `CADDY_MEM_LIMIT`
  (z. B. `768m`, `2g`) und `APP_CPUS`, `JOBS_CPUS`, `DB_CPUS`, `CADDY_CPUS`.
  Stösst ein Dienst an die Grenze, zeigt `docker inspect <container>`
  `"OOMKilled": true`; dann den Wert erhöhen.

**Optional**

- **Geheimnisse als Dateien** (Docker-Secrets): `SESSION_SECRET_FILE`,
  `PGPASSWORD_FILE`, `DATABASE_URL_FILE`, `ADMIN_PASSWORD_FILE` statt der
  Variablen (nie beide). **Überholt durch Abschnitt 33:** `compose.yaml` hängt
  die Secrets selbst ein; ein Override wie unten ist nicht mehr nötig und
  gehört entfernt. Beispiel als `compose.override.yaml` neben
  `compose.yaml`:

  ```yaml
  services:
    app:
      environment:
        SESSION_SECRET: ""
        SESSION_SECRET_FILE: /run/secrets/session_secret
        PGPASSWORD: ""
        PGPASSWORD_FILE: /run/secrets/db_app_password
      secrets: [session_secret, db_app_password]
    jobs:
      environment:
        PGPASSWORD: ""
        PGPASSWORD_FILE: /run/secrets/db_app_password
      secrets: [db_app_password]
  secrets:
    session_secret:  { file: ./geheim/session_secret }
    db_app_password: { file: ./geheim/db_app_password }
  ```

  `compose.yaml` verlangt `SESSION_SECRET` und `DB_APP_PASSWORD` weiterhin in
  `.env` (die Prüfung `:?` greift vor dem Override). `DB_APP_PASSWORD` braucht
  der Dienst `db-rolle` als echten Wert; für `SESSION_SECRET` genügt dort ein
  Platzhalter. Postgres und `db-rolle` bekommen ihre Passwörter weiter als
  Umgebungsvariable (`db-rolle` läuft nur kurz).
- **Verschlüsselte Sicherungen** mit [age](https://age-encryption.org):
  Auf einem **anderen** Rechner `age-keygen -o backup-schluessel.txt`; den
  privaten Schlüssel dort und offline aufbewahren. Auf dem Server
  `apt install age` und beim Aufruf
  `BACKUP_AGE_EMPFAENGER=age1… ./scripts/backup.sh` (oder
  `BACKUP_AGE_EMPFAENGER_DATEI=<Datei mit einem Empfänger je Zeile>`). Es
  entstehen nur `db_….sql.gz.age` und `data_….tar.gz.age`, kein Klartext.
  Zurück: `BACKUP_AGE_IDENTITAET=backup-schluessel.txt ./scripts/restore.sh
  backups/db_….sql.gz.age backups/data_….tar.gz.age`. Den Datenschlüssel
  (`BACKUP_SCHLUESSEL_ZIEL`) weiterhin getrennt aufbewahren.

**Was sich für Clients ändert**

- **Ein Bestätigungsweg mit zweitem Faktor**: Bei aktivem TOTP verlangen
  jetzt alle Routen mit Passwortbestätigung zusätzlich `code` (TOTP- oder
  Wiederherstellungscode) **oder** `passkey` (Antwort auf
  `POST /auth/passkey/anmelden/optionen` mit `zweck: "zweiter_faktor"`), auch
  mit dem Verwalterpasswort: `token-create`, `qr-token`, alle Verwalterrouten
  unter `/auth/users`, `DELETE /bestand`, `/settings/sessions/andere-beenden`,
  SMTP-Änderung über `POST /settings` (`admin_password` + `code`),
  `zweiter-faktor/einrichten` und die bisherigen (Passwortwechsel, E-Mail,
  Passkey anlegen/löschen, 2FA abschalten, Haushalt beitreten mit
  `faktor_code`). Fehlt beides: 400 `zweiter_faktor_noetig` (mit
  `passkey: true`, wenn das Konto Passkeys hat). Die Webapp fragt den Code
  selbst nach. `zweiter-faktor/einrichten` antwortet bei schon aktivem
  Faktor ohne Code mit `zweiter_faktor_noetig` statt 409. Welche Routen das
  sind, steht im Vertrag als `x-bestaetigung` (`docs/openapi.json`).
- **Bremsen je Zugang**: Falsche Passwörter und falsche Codes zählen je
  Konto **und** Sitzung bzw. App-Token (über den Tausch hinweg); Codes in
  einem eigenen Zähler, 5 je Stunde, den nur ein richtiger Code löscht.
  Fehlversuche aus einer fremden Sitzung sperren die eigene nicht mehr.
- **Hinweis-Mails** (wo Mail eingerichtet ist): neuer App-Token, neuer
  QR-Zugang (an den Inhaber), neuer oder ernannter Verwalter und ein vom
  Verwalter entfernter zweiter Faktor (an alle Verwalter, der Faktor auch an
  das betroffene Konto).
- `GET /api/v1/startup-status` nennt Schritt und Unterstand nur noch
  angemeldet; anonym bleiben `ready`, `progress`, `total`.

**Aufgaben in den GitHub-Einstellungen (nur dort möglich)**

1. *Settings → Environments → New environment* `docker-hub`:
   *Required reviewers* (sich selbst), *Deployment branches and tags* →
   *Selected branches* `main`. Die Docker-Hub-Secrets `DOCKERHUB_USERNAME`
   und `DOCKERHUB_TOKEN` dort als *Environment secrets* anlegen und die
   gleichnamigen *Repository secrets* löschen. Danach wartet jeder
   Veröffentlichungslauf auf die Freigabe (einmal für beide Architekturen,
   einmal für Manifest und Signatur). Ohne diese Einrichtung legt GitHub die
   Umgebung beim ersten Lauf ohne Schutz an; der Lauf geht dann wie bisher.
2. *Settings → Branches*: Schutzregel für `main` mit den Pflicht-Checks
   *CI* und *Sicherheit*, kein Force-Push.
3. Der Trivy-Lauf für Caddy, PostgreSQL und pgweb ist jetzt scharf: Meldet
   er behebbare Lücken, den Dependabot-PR mit dem neuen Digest übernehmen
   oder die Lücke mit Grund und Ablaufdatum in `.github/trivy-betrieb.ignore`
   eintragen.

## 32. Runde 8 – Sicherheit

Was der Betrieb tun muss, steht zuerst; danach, was sich für Clients ändert.

**In den GitHub-Einstellungen**

- **Renovate statt Dependabot für Images und Actions**: `renovate.json` pflegt
  jetzt auch die Digests in `Dockerfile` und `compose.yaml` und die
  Commit-SHAs der Actions; `.github/dependabot.yml` ist entfernt, sonst kämen
  dieselben PRs doppelt. Prüfen, dass die Renovate-App für das Repository
  eingeschaltet ist (*Settings → GitHub Apps*). Die Sicherheitswarnungen von
  Dependabot (*Settings → Code security*) bleiben davon unberührt. Ein Sprung
  auf eine neue PostgreSQL-Hauptversion kommt erst nach Freigabe im
  Dependency-Dashboard: Er braucht einen Umzug der Daten (`POSTGRES-18.md`).

**Eigene, auf BRICK_HOST beschränkte CA (empfohlen, nicht automatisch)**

Caddys eigene Wurzel gilt auf jedem Gerät, das sie installiert hat, für jede
Adresse: Wer ihren Schlüssel aus `./caddy/data/caddy/pki/authorities/local/`
oder aus einer Sicherung von `./caddy/` bekommt, stellt Zertifikate für Bank
und Mail aus, denen diese Geräte trauen. `scripts/ca-einrichten.sh` legt
stattdessen eine Wurzel an, die nur für `BRICK_HOST` gilt (Name Constraints),
und eine Zwischenstelle für Caddy; der Schlüssel der Wurzel bleibt nicht auf
dem Server. Ohne diese Schritte läuft alles wie bisher.

1. Im Ordner mit `compose.yaml`:
   ```
   sudo sh scripts/ca-einrichten.sh
   ```
   Mit sudo, weil Caddy im Container als root ohne Capabilities nur Dateien
   liest, die root gehören. Es liest `BRICK_HOST` aus `.env` (oder
   `sudo sh scripts/ca-einrichten.sh nas.example.lan`)
   und schreibt `./caddy/ca/root.crt`, `zwischen.crt`, `zwischen-kette.crt`
   und `zwischen.key`. Den Schlüssel der Wurzel verwirft es; wer ihn behalten
   will: `sudo WURZEL_SCHLUESSEL=/media/usb/brickinventory-wurzel.key sh scripts/ca-einrichten.sh`
   — die Datei danach vom Server wegbringen. Die Ausgabe nennt den neuen
   Fingerabdruck. Braucht `openssl` auf dem Server.
2. Caddy mit der neuen CA starten und die alte CA samt ihren Zertifikaten
   entfernen, sonst liefert Caddy bis zur nächsten Erneuerung noch das alte
   Blatt aus (vorher eine Kopie offline ablegen, wer zurück will):
   ```
   docker compose stop caddy
   sudo rm -rf caddy/data/caddy/pki/authorities/local caddy/data/caddy/certificates/local
   docker compose up -d caddy
   ```
   `compose.yaml` hängt `./caddy/ca` nur lesend ein; das Startskript nimmt
   die eigene CA, sobald `zwischen.key` dort liegt, und gibt der App deren
   Wurzel (`/ca.crt`, QR-Code). Prüfen: Einstellungen → Sicherheit zeigt den
   Fingerabdruck aus Schritt 1.
3. Auf jedem Gerät die alte Wurzel „BrickInventory“ entfernen und die neue
   von `http://<BRICK_HOST>/ca.crt` installieren (Abschnitt 14, Fingerabdruck
   vergleichen).
4. Die Android-App einmal neu verknüpfen (QR-Code): Sie meldet sonst ein
   geändertes Zertifikat und verlangt den neuen Fingerabdruck.
5. Sicherungen von `./caddy/` aus der Zeit davor enthalten den Schlüssel der
   alten, unbeschränkten Wurzel: löschen oder wie ein Passwort verwahren.
   Ist die alte Wurzel von allen Geräten entfernt, ist er wertlos.

Die Zwischenstelle gilt 3649 Tage. Danach (oder bei Verdacht auf einen
abgeflossenen `zwischen.key`) mit `sudo NEU=1 sh scripts/ca-einrichten.sh` eine
neue CA anlegen und die Schritte 2–4 wiederholen. Zurück zu Caddys CA:
`./caddy/ca` umbenennen und Caddy neu starten; er legt dann eine neue,
unbeschränkte Wurzel an (Schritte 3–4).

**Beim Update** (`docker compose up -d --build`)

- **pgweb** startet mit `--lock-session`: Die Oberfläche bietet keinen
  Verbindungsdialog mehr und spricht nur mit `PGWEB_DATABASE_URL`, nicht mit
  anderen Hosts oder Ports im Docker-Netz.
- **db-rolle** entzieht `PUBLIC` das Recht `TEMPORARY` an der Datenbank: Die
  Leserolle legt keine temporären Tabellen mehr an. Die App behält es als
  Eigentümerin der Datenbank. Nichts zu tun; der Dienst läuft bei jedem `up`.

**Was sich für Clients ändert**

- **Token oder Sitzung, nie beides**: `POST /auth/login` ohne `ohne_token`
  und `POST /auth/passkey/anmelden` mit `mit_token` geben nur noch den Token
  aus, kein `Set-Cookie` und keine Sitzung. Bisher hielt jeder solche Client
  neben dem Token (Scope `app`) eine Sitzung mit den vollen Rechten des
  Kontos. Die Web-App (`ohne_token: true`) und die Android-App (keine
  Cookies) sind nicht betroffen; ein eigenes Skript, das sich auf den Keks
  aus einer Token-Anmeldung verlassen hat, meldet sich mit `ohne_token: true`
  an. Kann der Token nicht gespeichert werden, antwortet die Anmeldung jetzt
  immer mit 500 `token_nicht_ausgestellt`.
- **Endgültig löschen nur mit Bestätigung**: `DELETE /papierkorb`,
  `DELETE /papierkorb/:id` und `DELETE /vouchers/:id` verlangen wie
  `DELETE /bestand` das Passwort (`password`) und bei aktivem zweitem Faktor
  `code` oder `passkey` im Rumpf; ohne antworten sie 400
  `aktuelles_passwort_falsch` bzw. `zweiter_faktor_noetig`. Die Web-App fragt
  beides ab. Die Android-App muss beim Löschen eines Gutscheins nachziehen
  (Passwortdialog, Rumpf am `DELETE`); bis dahin scheitert das Löschen dort
  mit der Meldung des Servers.
- **Kopierte App-Tokens fallen auf** (Migration 0092): Ein durch
  `POST /auth/token-rotieren` ersetzter Token bleibt als Hash in
  `api_tokens_verbraucht` stehen, solange sein Gerät angemeldet ist. Kommt er
  mehr als 60 Sekunden nach der ersten Nutzung des Nachfolgers wieder (als
  Anfrage oder zum Tausch), endet die ganze Kette dieses Geräts samt
  Nachfolger, und der Inhaber bekommt die Mail „ein schon ersetzter
  App-Zugang wurde erneut benutzt“. Andere Geräte bleiben angemeldet. Für
  Clients heisst das: den neuen Token speichern, bevor er benutzt wird, und
  den alten danach nicht mehr schicken — die Android-App tut das schon.
- **Gutscheine nur maskiert**: Jede Antwort mit einem Gutschein
  (`GET /vouchers`, `POST`/`PUT /vouchers`, `POST /vouchers/pdf`,
  `POST /vouchers/:id/guthaben`) trägt als `number` nur `…` und die letzten
  vier Ziffern und als `pin` `•••` (oder `null` ohne PIN). Den Klartext gibt
  `POST /vouchers/:id/klartext` mit `password` (bei aktivem zweitem Faktor
  dazu `code` oder `passkey`): `{ success, id, number, pin }`. Jeder Abruf
  steht im Verwaltungsprotokoll („Gutscheinnummer und PIN angezeigt“, mit
  den letzten vier Ziffern). `PUT /vouchers/:id` nimmt die Maske als
  „unverändert“: Ein Formular, das sie zurückschickt, ändert Nummer und PIN
  nicht. Die Web-App fragt beim Einblenden der PIN, beim Kopieren und vor
  dem Löschen das Passwort ab; „Rückgängig“ nach dem Löschen gibt es nur,
  wenn der Klartext vorher abgerufen wurde. Die Android-App zeigt bis zu
  ihrem Nachzug nur die Maske (Kopieren liefert „…1234“).
- **Gutschein-PDFs nur mit Einmal-Ticket**: `GET /vouchers/:id/pdf` und
  `GET /vouchers/export/pdf` verlangen `?ticket=…`, sonst 403
  `pdf_freigabe_noetig`. Das Ticket gibt `POST /vouchers/:id/pdf-freigabe`
  bzw. `POST /vouchers/export/pdf-freigabe` mit `password` (bei aktivem
  zweitem Faktor dazu `code` oder `passkey`): `{ success: true, ticket,
  gueltig_sek: 60 }`. Es gilt für genau einen Abruf, 60 Sekunden, nur für
  dieses Konto und dieses PDF (bzw. den Export); jede Freigabe steht im
  Verwaltungsprotokoll. Der Dateiname ist jetzt `gutschein-<id>.pdf`, ohne
  Kartennummer. Die Web-App lädt das PDF einmal und zeigt es aus dem
  Speicher. Die Android-App muss nachziehen: Bis dahin öffnet sie keine
  Gutschein-PDFs (403).

## 33. Runde 9 – Sichere Vorgaben im Betrieb

Bisher waren die sicheren Wege angeboten, ab dieser Fassung sind sie
**Pflicht**. Ein `docker compose up -d --build` ohne die Schritte unten
scheitert mit einer Meldung, die auf diesen Abschnitt zeigt. Reihenfolge
einhalten; alles im Ordner mit `compose.yaml`.

**1. Geheimnisse als Dateien (Pflicht)**

`SESSION_SECRET`, `DB_PASSWORD`, `DB_APP_PASSWORD` und die pgweb-Passwörter
stehen nicht mehr in der Umgebung der Container (die zeigt `docker inspect`
jedem mit Zugang zu Docker), sondern als Docker-Secrets unter
`/run/secrets/`. Die Dateien liegen in `./geheimnisse/`:

```
sh scripts/geheimnisse-einrichten.sh
```

Das Skript übernimmt die Werte aus der bisherigen `.env` und erzeugt fehlende
zufällig. Vorhandene Dateien überschreibt es nie. Liegt `./pgdata18` schon da
und fehlt `DB_PASSWORD` in `.env`, bricht es ab: Das Superuser-Passwort steht
in der Datenbank, ein neues passte nicht. Danach:

- Die Zeilen `SESSION_SECRET`, `DB_PASSWORD`, `DB_APP_PASSWORD`,
  `PGWEB_PASSWORD` und `PGWEB_DB_PASSWORD` aus `.env` löschen. Das Skript
  nennt sie am Ende.
- `./geheimnisse/` wie `schluessel/` behandeln. Der Ordner ist nur für seinen
  Besitzer offen (700), die Dateien darin sind lesbar (444), damit die
  Dienste sie ohne root lesen. Nicht ins Repository, nicht neben die
  Sicherungen.
- Wer `compose.override.yaml` aus Abschnitt 31 („Geheimnisse als Dateien“)
  angelegt hat, löscht dort die `secrets`- und `*_FILE`-Einträge.
  `compose.yaml` macht das jetzt selbst.

**2. Zertifikat: eigene CA, Let's Encrypt oder ausdrücklich Caddys CA (Pflicht)**

Caddy fällt nicht mehr still auf seine eigene CA zurück. Diese CA hat keine
Namensbeschränkung: Ein Gerät mit ihrer Wurzel traut ihr für jede Adresse.
Ohne eine der drei Angaben startet Caddy nicht. `docker compose logs caddy`
zeigt dann „keine eigene, auf BRICK_HOST beschränkte CA“.

- **Empfohlen, im Heimnetz:** `sudo sh scripts/ca-einrichten.sh`, danach
  weiter wie in Abschnitt 32 (alte CA entfernen, neue Wurzel auf die Geräte,
  App neu verknüpfen). Wer das schon gemacht hat, muss nichts tun.
- **Öffentlicher Name** (aus dem Internet auf Port 80 und 443 erreichbar): in
  `.env` `BRICK_TLS=acme` und optional `ACME_EMAIL=…`. Das Zertifikat kommt
  dann von Let's Encrypt, auf die Geräte muss keine Wurzel, und `/ca.crt`
  antwortet 404. Die Android-App einmal neu verknüpfen.
- **Übergang, bewusst:** `CA_OHNE_NAMENSBESCHRAENKUNG=ja` in `.env` startet
  wie bisher mit Caddys CA und schreibt bei jedem Start eine Warnung ins
  Protokoll.

**Fingerabdruck vergleichen (Pflichtschritt beim Installieren der Wurzel).**
`http://<BRICK_HOST>/ca.crt` ist unverschlüsselt. Wer im Netz mitliest, kann
die Datei austauschen. Vor dem Installieren den SHA-256-Fingerabdruck, den
das Gerät anzeigt, mit dem auf dem Server vergleichen:

```
docker compose logs caddy | grep Fingerabdruck
```

`scripts/ca-einrichten.sh` nennt denselben Wert bei der Einrichtung. Weicht er
ab, nicht installieren.

**3. Sicherungen nur verschlüsselt (Pflicht)**

`scripts/backup.sh` sichert ohne Empfänger nichts mehr. Ein Cron-Lauf meldet
dann `FEHLER: kein Empfänger`. Einmalig einrichten:

1. Auf einem **anderen** Rechner: `age-keygen -o backup-schluessel.txt`.
   Diese Datei offline aufbewahren (Passwort-Safe, USB-Stick). Sie ist der
   einzige Weg zurück an die Daten.
2. Den öffentlichen Schlüssel (`age1…`, steht in der Ausgabe) auf dem Server
   in `./backup-empfaenger.txt` eintragen, einen je Zeile. Für einen zweiten
   Verwahrer eine zweite Zeile anlegen.
3. `apt install age` auf dem Server, dann einmal `./scripts/backup.sh`. Es
   entstehen nur noch `db_….sql.gz.age` und `data_….tar.gz.age`.
4. Zurückspielen probehalber: `BACKUP_AGE_IDENTITAET=backup-schluessel.txt
   ./scripts/restore.sh backups/db_….sql.gz.age backups/data_….tar.gz.age`.

Unverschlüsselte Sicherungen gibt es nur noch mit ausdrücklichem
`BACKUP_KLARTEXT=ja`. Alte `*.sql.gz` lassen sich weiter einspielen. Den
Datenschlüssel (`BACKUP_SCHLUESSEL_ZIEL`) weiter getrennt aufbewahren.

**4. pgweb (nur wer es benutzt)**

- Die Passwörter kommen jetzt aus `./geheimnisse/`:
  `PGWEB=ja sh scripts/geheimnisse-einrichten.sh`, danach
  `docker compose up -d db-rolle`. Das Passwort für die Anmeldung im Browser
  steht in `geheimnisse/pgweb_password` (bisheriges `PGWEB_PASSWORD` wird
  übernommen). Ohne diesen Schritt hat die Leserolle kein Passwort und pgweb
  startet nicht.
- pgweb läuft als uid 1000, schreibgeschützt, ohne Capabilities und in einem
  eigenen Netz `pgweb-net` nur mit `postgres`. App, Jobs und Caddy erreichen
  es nicht mehr.
- Die Leserolle liest nur noch eine **Allowlist** je Tabelle
  (`LESEN_SPALTEN` in `postgres/app-rolle.sh`). Eine neue Tabelle oder
  Spalte ist für pgweb unsichtbar, bis sie dort eingetragen ist. Nicht mehr
  lesbar sind zusätzlich `auftraege.nutzlast`, `vouchers.number` und
  `nummer_suche`, `passkeys.credential_id` und `public_key`,
  `zweiter_faktor.letzter_schritt` und die ganze Tabelle `idempotenz`.

**5. Anmeldebremse an Caddy (nichts zu tun)**

Die Anmeldewege (`/api/v1/auth/login`, `register`, `forgot-password`,
`reset-password`, `bestaetigung-erneut`, `qr-login`, `token-rotieren`,
`passkey/anmelden`) gehen höchstens zu viert gleichzeitig an die App, mit
Rümpfen bis 16 KB. Der Rest wartet bei Caddy. Eine Flut aus vielen Adressen
verlangsamt so die Anmeldung, belegt aber nicht alle Kerne mit bcrypt.
Echte Raten je Adresse kann das Standard-Image von Caddy nicht zählen (dafür
bräuchte es ein eigenes Caddy-Image mit Zusatzmodul). Die Grenzen je
Adresse und Konto setzt weiterhin der Server.

**6. Lieferkette (nichts zu tun; zum Prüfen)**

- Das Image installiert Abhängigkeiten mit `npm ci --ignore-scripts`; nur
  esbuild baut sein Install-Skript gezielt (`npm rebuild esbuild`). Die CI
  macht es genauso und ist ab einer Lücke der Stufe `moderate` rot.
- Jedes veröffentlichte Image trägt eine Herkunftsbescheinigung und eine
  Stückliste. Prüfen: siehe README im Wurzelverzeichnis
  (`cosign verify …`, `gh attestation verify …`). In den
  GitHub-Einstellungen ist nichts zu tun: Der Workflow braucht nur
  `attestations: write`, das er selbst anfordert.

## 34. Runde 10 – Mandantentrennung, Routing und Verwalter

Für Betreiber in Docker ist nichts umzustellen, ausser beim zweiten Faktor
der Verwalter (Punkt 1). Wer ausserhalb von Docker betreibt, beachtet Punkt 4.

**1. Verwalter brauchen einen zweiten Faktor**

Ein Konto mit Verwalterrechten ohne Code-Generator (TOTP) kommt nach der
Anmeldung nur noch bis zu dessen Einrichtung. Ein Passkey allein genügt
nicht: Die Anmeldung mit Passwort verlangt den zweiten Faktor nur bei
eingerichtetem Code-Generator. Die Webapp
zeigt dafür eine eigene Seite; alle anderen Anfragen antworten mit 403
`zweiter_faktor_pflicht`. Empfehlung: Vor dem Update in der Webapp unter
Einstellungen → Zweiter Faktor einrichten, solange niemand sonst das
Passwort kennen kann. App-Zugänge mit Scope `app` tragen keine
Verwalterrechte und sind nicht betroffen. Hat ein Verwalter Telefon und
Codes verloren, setzt ein anderer Verwalter den Faktor zurück (wie bisher);
danach verlangt die Anmeldung die neue Einrichtung.

**2. BrickLink-Nummern je Konto**

Korrekturen beim Wanted-Import und die BrickLink-Nr. einer eigenen Figur
gelten nur noch für das eigene Konto (Tabelle `bl_zuordnung_eigen`,
Migration 0094). Die gemeinsame Zuordnung schreiben nur noch Rebrickable und
BrickLink, und ein dort vorhandener Wert wird nicht mehr ersetzt. Was vor
dem Update ein Konto in die gemeinsame Zuordnung geschrieben hat, lässt sich
von geprüften Werten nicht unterscheiden. Wer fremde Konten auf dem Server
hat und an Figurenpreisen oder -bildern zweifelt, leert die Figurenzeilen;
abweichende Nummern trägt danach jedes Konto selbst wieder ein:

```
docker compose exec postgres psql -U brickinventory -c "DELETE FROM bl_zuordnung WHERE art IN ('fig','set')"
```

**3. Weitere Härtungen**

- Pfade unterscheiden Gross- und Kleinschreibung: `/api/v1/Sets` ist 404.
- Ohne Anmeldung liest der Server höchstens 16 KB Rumpf (Anmelden,
  Registrieren, Zurücksetzen); alles andere erst nach der Anmeldung.
- Gutschein-PDFs: höchstens 200 Seiten (sonst 422 mit Hinweis), gelesen in
  einem eigenen Thread, je Konto eines zugleich. Uploads allgemein höchstens
  zwei, Ereignisströme sechs je Konto zugleich (sonst 429).
- Passwörter: mindestens **12** Zeichen. Bestehende Passwörter gelten weiter;
  die Regel greift beim nächsten Wechsel.
- Eine Anmeldung der App mit Passwort schickt wie `token-create` eine
  Hinweis-Mail „neuer App-Zugang“.
- Registrierungen, deren Adresse nach 7 Tagen nicht bestätigt ist, löscht der
  tägliche Aufräumlauf (Migration 0095). Konten, die nur eine neue Adresse
  noch nicht bestätigt haben, bleiben.
- Jedes Konto kann sich unter Einstellungen → Gefahrenzone selbst löschen
  (Passwort und, falls eingerichtet, zweiter Faktor). Das letzte aktive
  Verwalterkonto kann es nicht.

**4. Betrieb ohne Docker: NODE_ENV und Superuser**

- `npm start` setzt jetzt `NODE_ENV=production`. Ohne `NODE_ENV` gelten die
  Regeln des Betriebs: Ohne eigenes `SESSION_SECRET` (mindestens 32 Zeichen)
  startet der Server nicht. Das Entwicklungsgeheimnis gibt es nur bei
  ausdrücklichem `NODE_ENV=development` oder `test` (`npm run dev` setzt es).
- In Produktion verweigert der Server den Start als Datenbank-Superuser
  (`COPY … PROGRAM` hiesse bei einer Lücke Codeausführung auf dem
  Datenbankhost). Richtig ist eine eigene Rolle (Abschnitt 29; in Docker
  richtet `db-rolle` sie ein). Wer bewusst als Superuser betreibt, setzt
  `DB_SUPERUSER_ERLAUBT=1`; der Start warnt dann bei jedem Lauf.

## 35. Runde 11 – Langsame Anfragen, Host-Kopf und E-Mail-Bestätigung

Für Betreiber in Docker hinter Caddy ist nichts umzustellen; das neue
`Caddyfile` kommt mit dem Update. Wer ohne Caddy (Klartext, Port 3000) oder
mit eigenem Reverse-Proxy betreibt, beachtet Punkt 2.

**1. Langsame Clients blockieren die Anmeldung nicht mehr**

- Caddy liest den Rumpf der Anmeldewege ganz, bevor er eine der vier
  Verbindungen zur App belegt (`request_buffers 32KB`); vorher konnten vier
  absichtlich langsame Rümpfe die Anmeldung für alle anhalten. Köpfe müssen
  in 10 s ankommen (`timeouts { read_header 10s }`, Vorgabe von Caddy: eine
  Minute). Eine harte Frist für Rümpfe setzt das Caddyfile bewusst nicht: Sie
  bräche lange Uploads (Anleitungen bis 50 MB) ab.
- Die App selbst: Kopf 15 s, ganze Anfrage fünf Minuten (wie bisher die
  Vorgabe von Node, jetzt ausdrücklich). Ohne Anmeldung muss der Rumpf
  (höchstens 16 KB) in 10 s da sein, sonst `408 anfrage_zu_langsam`. Wer
  einen eigenen Reverse-Proxy vor die App stellt, sollte dort die
  Anmeldewege ebenso puffern.

**2. Mit `APP_BASE_URL` nur noch unter diesem Namen**

Ist `APP_BASE_URL` gesetzt, antwortet die App auf einen anderen `Host`-Kopf
mit `421 fremder_host` („Dieser Server antwortet nur unter …"). Das schützt
im Klartextbetrieb gegen DNS-Rebinding. Frei bleiben `localhost`/`127.0.0.1`,
Anfragen mit App-Token (`Authorization: Bearer`), `/ca.crt` und
`/api/v1/health…`. Hinter Caddy ändert sich nichts, weil Caddy ohnehin nur
`BRICK_HOST` bedient. Wer im Klartextbetrieb den Server im Browser unter
einer IP-Adresse aufruft, `APP_BASE_URL` aber auf einen Namen gesetzt hat,
nimmt künftig diesen Namen (oder setzt `APP_BASE_URL` auf die Adresse, die
alle Geräte benutzen). Die Android-App mit eingerichtetem Zugang ist nicht
betroffen; eine neue Anmeldung der App braucht dieselbe Adresse wie
`APP_BASE_URL` (der QR-Code trägt sie ohnehin).

**3. E-Mail-Bestätigung per Knopf**

Der Link in der Bestätigungsmail (`/verify?token=…`) bestätigt nicht mehr
beim Öffnen. Er öffnet eine Seite mit dem Knopf „Adresse bestätigen"; erst
der Knopf bestätigt (`POST /api/v1/auth/email-bestaetigen` `{ token }`,
ohne Anmeldung, 400 `bestaetigungslink_ungueltig` bei falschem oder
abgelaufenem Link). So bestätigt kein Link-Scanner eines Mailanbieters eine
fremde Adresse. Links aus älteren Mails gelten weiter, brauchen aber den
Klick. Die Android-App ruft `/verify` nicht auf; der Link öffnet auch auf dem
Telefon die Webseite.

**4. Weitere Härtungen**

- Fehler mit Status 4xx ohne eigenen Code nennen nicht mehr den Text einer
  Bibliothek (z. B. „Failed to decode param", „incorrect header check",
  Dateipfade), sondern `anfrage_ungueltig`, `nicht_gefunden` oder
  `anfrage_zu_gross` mit Satz in der Sprache des Anfragenden. Der Rohtext
  steht im Protokoll.
- Kaufpreis umhängen (`PUT …/acquisitions/:id` mit `owner_user_id`): Eine
  Erfassung eines fremden Kontos antwortet wie eine fehlende mit 404
  `kaufpreis_nicht_gefunden` statt 403 `kein_schreibrecht`.
- Bild-Proxy: Der `Content-Type` geht nur noch aus einer festen Liste hinaus
  (JPEG, PNG, GIF, WebP, AVIF), sonst `image/jpeg`; der rohe Wert des CDN
  nie mehr. Vorhandene Cache-Einträge werden beim Ausliefern ebenso normiert.

## 36. Runde 11 – Erststart des Verwalters ohne dritte Passwortabfrage

- `POST /api/v1/auth/zweiter-faktor/einrichten` geht bis fünf Minuten nach
  einer Anmeldung mit Passwort (oder einem Passwortwechsel) in **derselben
  Sitzung** einmal ohne `password`. Mit App-Token gibt es diese Frist nie; die
  Android-App schickt das Passwort wie bisher mit.
- Ohne Passwort und ohne Frist antwortet die Route jetzt mit 400
  `aktuelles_passwort_erforderlich` (vorher `aktuelles_passwort_falsch`); die
  Bremse für Fehlversuche zählt das nicht mehr mit.
- Eingerichtet ist der zweite Faktor weiterhin erst mit dem Code aus der App.
  Sitzungen von vor dem Update haben keine Frist; nach dem Update genügt eine
  neue Anmeldung.

## 37. Runde 12 – Mailadressen, zweiter Faktor, Protokoll und Sicherung

**1. Nur noch reine E-Mail-Adressen**

- Registrierung, Profil, „Passwort vergessen“, „Bestätigung erneut senden“
  und der SMTP-Test nehmen nur noch eine einzelne Adresse an: kein
  Anzeigename (`Name <a@b.de>`), keine Liste (`a@b.de,c@d.de`), keine der
  Zeichen `< > " , ; : ( ) [ ] \`, keine Leer- oder Steuerzeichen. Sonst 400
  `email_ungueltig`.
- Der Versand prüft jede Adresse ein zweites Mal und gibt sie nodemailer als
  Umschlag (`envelope`) vor; an eine unreine gespeicherte Adresse geht keine
  Mail mehr.
- **Bestand:** Beim Start meldet der Server Konten, deren gespeicherte Adresse
  die Regel verletzt (`[konto] … Konto/Konten mit einer E-Mail-Adresse, die
  keine einzelne reine Adresse ist (IDs …)`). Geändert wird nichts. Diese
  Konten melden sich weiter mit dem Benutzernamen an, bekommen aber keine
  Mails; im Konto eine gültige Adresse eintragen oder, wenn es ein
  Spam-Konto ist, unter Verwaltung löschen. Prüfen von Hand:
  `SELECT id, username FROM users WHERE email ~ '[<>",;:() ]';`

**2. Zweiter Faktor: Passwort nur beim Pflicht-Erststart entbehrlich**

- `POST /api/v1/auth/zweiter-faktor/einrichten` ohne `password` geht nur noch
  für einen **Verwalter ohne Faktor** in den fünf Minuten nach seiner
  Anmeldung (Abschnitt 36). Jedes andere Konto bekommt 400
  `aktuelles_passwort_erforderlich`; Webapp und Android-App fragen dann nach
  dem Passwort (die App schickt es ohnehin immer mit).
- Neue Mails an den Inhaber, wenn SMTP eingerichtet ist: „zweiter Faktor
  eingerichtet“ und „zweiter Faktor abgeschaltet“. Scheitert der Versand,
  bleibt die Änderung bestehen; der Fehler steht im Protokoll.

**3. Anmeldeereignisse im Protokoll**

- Je fehlgeschlagener Anmeldung, Sperre, falschem Code und falscher
  Bestätigung eine Warnzeile `[anmeldung] <ereignis>` mit JSON-Kontext
  `{"ereignis", "adresse", "konto"}` (bei Bestätigungen `art`, `zugang`),
  auf stderr (Docker-Log) und in `app_logs` (Verwaltung → Protokoll).
  Ereignisse: `anmeldung_fehlgeschlagen`, `anmeldung_gesperrt`,
  `zweiter_faktor_falsch`, `bestaetigung_fehlgeschlagen`,
  `bestaetigung_gesperrt`. Nie Passwort oder Code; ein unbekannter Name
  erscheint nur als `"konto":"unbekannt"`. `adresse` ist die IPv4-Adresse
  bzw. das IPv6-/64.
- fail2ban-Beispiel (Docker-Log als Quelle):
  `failregex = "nachricht":"\[anmeldung\] anmeldung_fehlgeschlagen".*"adresse":"<HOST>"`
  Hinter Caddy steht dort die echte Adresse nur mit `TRUST_PROXY`.
- Erreicht ein Konto die Kontosperre (fünf Fehlversuche in 15 Minuten),
  bekommt der Inhaber eine Mail „mehrere fehlgeschlagene Anmeldeversuche“,
  höchstens einmal am Tag.

**4. Einstellungen: Registrierung und API-Schlüssel nur mit Passwort**

- `POST /api/v1/settings` verlangt für `registration_enabled`,
  `rebrickable_api_key`, `brickset_api_key` und die vier BrickLink-Schlüssel
  (wie bisher für `smtp_*`) `admin_password` und bei aktivem Faktor den Code —
  nur wenn sich der Wert wirklich ändert. Ohne Passwort 400
  `aktuelles_passwort_erforderlich`. Alle Verwalter bekommen eine Mail.
- Der Konfigurations-Import übernimmt diese Schlüssel nicht mehr; sie stehen
  in `smtp_uebergangen` (Name aus Kompatibilität) und in der Meldung.
- Skripte, die diese Werte per API setzen, müssen `admin_password`
  mitschicken. Die Android-App ändert sie nicht.

**5. Sicherung ohne Klartext am Ziel**

- `scripts/backup.sh` leitet `pg_dump | gzip` und `tar` direkt in `age`; am
  Ziel liegt bis zum Umbenennen nur `….age.teil`, nie Klartext. Für die
  Endmarke bleibt das letzte Kilobyte des Dumps in einem privaten
  Arbeitsordner (`mktemp -d`, 0700, unter `$TMPDIR`), der am Ende
  verschwindet. Dateinamen bleiben gleich; `restore.sh` liest alte und neue
  Sicherungen.
- Bricht die Sicherung ab, bleibt am Ziel nichts liegen (vorher: eine halbe
  `.gz`-Datei, die das Skript erst danach löschte).
- Älteres Klartext-Material aus früheren Abbrüchen am Ziel bitte von Hand
  prüfen: `ls "$ZIEL" | grep -v '\.age$'`.

**6. Wiederherstellen weist psql-Befehle ab**

- `scripts/restore.sh` lehnt einen Dump ab, der ausserhalb der COPY-Daten eine
  Zeile mit `\` trägt (ausser `\restrict`/`\unrestrict` von pg_dump), und
  stellt dem Dump ein eigenes `\restrict <zufall>` voran: psql führt dann gar
  keinen Backslash-Befehl aus. `psql -X` liest keine `.psqlrc`. Nötig ist ein
  psql ab 16.10/17.6/18.0 — das Image aus `compose.yaml` hat ihn.

**7. Mehrere Web-Prozesse: Token-Widerruf sofort**

- Ein Widerruf (Abmelden, Löschen, Passwortwechsel, Faktor) meldet sich über
  `NOTIFY token_widerrufen`; jeder Web-Prozess leert seinen Token-Speicher.
  Mit einem Web-Prozess ändert sich nichts.

**8. Ohne APP_BASE_URL im Betrieb**

- Mit `NODE_ENV=production` und ohne `APP_BASE_URL` schreibt der Web-Prozess
  beim Start eine Fehlerzeile (`❌ [start] APP_BASE_URL fehlt im Betrieb …`):
  Der Host-Filter gegen DNS-Rebinding ist dann aus. Er startet trotzdem —
  `compose.yaml` setzt die Variable immer; wer ohne Compose startet, sollte
  sie setzen. (Seit Abschnitt 38, Punkt 5: Startverbot.)

## 38. Runde 12 – Neue E-Mail-Adresse erst nach Bestätigung, Rechte und Startverbot

**1. Eine geänderte E-Mail-Adresse gilt erst nach dem Link**

- `PUT /api/v1/auth/profile` mit neuer Adresse trägt sie nur noch als
  *ausstehend* ein (neue Spalten `users.email_neu`, `email_neu_token`,
  `email_neu_bis`, Migration 0096). Der Link (24 Stunden) geht an die neue
  Adresse, ein Hinweis an die bisherige. Bis zum Klick gelten die bisherige
  Adresse, ihre Anmeldung und ihre Mails weiter; das Konto bleibt benutzbar.
- Beim Einlösen wird erneut geprüft, ob die Adresse frei ist. Ist sie
  inzwischen vergeben, antwortet `POST /auth/email-bestaetigen` mit
  `email_vergeben`, und die ausstehende Adresse fällt weg.
- `GET /api/v1/auth/profile` liefert zusätzlich `email_neu` (optional, `null`
  ohne Antrag); die Weboberfläche zeigt sie unter dem Feld. Die Android-App
  liest das Feld nicht; nach dem Speichern zeigt sie die bisherige Adresse,
  bis der Link geöffnet ist.
- Vergeben ist eine Adresse nur noch, wenn sie bestätigt ist, einem Verwalter
  oder einem Konto ohne offene Registrierung gehört, oder einer offenen
  Registrierung, die jünger als 24 Stunden ist. Eine ältere, nie bestätigte
  Registrierung räumt eine neue Registrierung (oder Bestätigung) mit derselben
  Adresse ab; sie war nie benutzbar. *Passwort vergessen* findet nur noch
  Konten mit bestätigter Adresse.
- Ohne Mailversand (kein SMTP, keine `APP_BASE_URL`) wird eine neue Adresse
  nie gültig. Im Konsolenmodus (ohne SMTP) steht der Link nur mit
  `MAIL_KONSOLE_MIT_TOKEN=1` lesbar im Server-Protokoll.

**2. Altbestand: unbestätigte Adressen werden ausstehend**

- Migration 0096 verschiebt jede unbestätigte Adresse, die nicht zu einer
  offenen Registrierung gehört, nach `email_neu` (`users.email` wird leer).
  Ein noch gültiger Link gilt weiter. So eine Adresse stammte aus einer
  Profiländerung und konnte einer fremden Person gehören; gelöscht wird nichts.
- Diese Konten melden sich danach ohne Adresse an (vorher waren
  Nicht-Verwalter bis zur Bestätigung gesperrt). Verwalter darunter bekommen
  Verwalter-Mails erst wieder nach der Bestätigung.
- Der Start meldet Konten mit ausstehender Adresse ohne gültigen Link:
  `⚠️ [konto] … nie bestätigten Adresse (IDs …)`. Abhilfe: Die Adresse im
  Profil erneut eintragen, dann kommt ein neuer Link. Nachsehen:
  `SELECT id, username, email_neu FROM users WHERE email_neu IS NOT NULL;`

**3. Erster API-Schlüssel ohne Passwort nur im Einrichtungsassistenten**

- Einen bisher leeren Rebrickable-, Brickset- oder BrickLink-Schlüssel setzt
  ein Verwalter ohne Passwort nur noch, solange die Einrichtung nicht
  abgeschlossen ist (`einrichtung_erledigt`). Danach fragt auch der erste
  Schlüssel nach dem Passwort (`aktuelles_passwort_erforderlich`).

**4. Hochgeladene Dateien nur für den Dienst lesbar**

- Der Entrypoint setzt `umask 077`: Was der Dienst unter `./data` neu anlegt,
  ist 0600 bzw. 0700. Bei jedem Start zieht er `data/uploads` nach
  (`chmod -R go-rwx`, als `brickinv`). Der Upload selbst setzt Datei 0600 und
  Ordner 0700, auch ohne Entrypoint; ohne Docker einmal von Hand:
  `chmod -R go-rwx data/uploads`.
- `backup.sh` liest neue Dateien unter `./data` daher nur als root (wie im
  Cron-Beispiel) oder unter der UID von `brickinv`.

**5. Ohne APP_BASE_URL im Betrieb startet der Web-Prozess nicht**

- Mit `NODE_ENV=production`, ohne `APP_BASE_URL` und nicht als `ROLLE=jobs`
  bricht der Start ab (`[start] APP_BASE_URL fehlt im Betrieb … Start
  verweigert`). `compose.yaml` setzt die Variable immer; betroffen ist nur ein
  Start ohne Compose. Wer bewusst ohne Host-Filter laufen will, setzt
  `APP_BASE_URL_FEHLT_OK=1`; dann startet er mit der bisherigen Fehlerzeile.

**6. Anmeldung unter Last**

- Ist die Warteschlange der Passwortprüfungen voll, kommt eine Anmeldung, die
  zuletzt von derselben Adresse (IPv6: /64) mit demselben Namen gelang, vorne
  in die Schlange und wird nicht wegen deren Länge abgewiesen. Eine Flut aus
  fremden Adressen sperrt bekannte Geräte so nicht aus. Nichts zu tun.

## 39. Runde 13 – Registrierung ohne Adresssperre, Obergrenzen, Sicherung

**1. Eine Registrierung belegt ihre Adresse erst mit der Bestätigung**

- `POST /api/v1/auth/register` legt die Adresse wie eine Profiländerung nur
  als *ausstehend* ab (`users.email_neu`, Link in `email_neu_token`, 24
  Stunden). `users.email` bleibt bis zum Klick leer. Mehrere offene
  Registrierungen mit derselben Adresse dürfen nebeneinander stehen; die
  erste Bestätigung gewinnt, jede spätere antwortet `email_vergeben`. Damit
  gilt Abschnitt 38.1 („eine offene Registrierung jünger als 24 Stunden
  belegt“) nicht mehr: Eine fremde, unbestätigte Registrierung sperrt
  niemanden.
- Unverändert: Eine offene Registrierung meldet sich nicht an (Absage wie
  ein falsches Passwort), *Passwort vergessen* findet nur bestätigte
  Adressen, der Aufräumlauf löscht offene Registrierungen nach 7 Tagen, und
  die Antwort der Registrierung verrät nichts. Die Mail „Registrierung mit
  deiner E-Mail-Adresse“ geht nur noch an bestätigte Adressen und nennt
  keinen Benutzernamen mehr.
- *Bestätigung erneut senden* schickt einen neuen Link nur, wenn genau eine
  offene Registrierung die Adresse nennt; sonst ginge ein Link zu einem fremd
  angelegten Konto mit. Wer dann keinen gültigen Link hat, registriert sich
  unter einem anderen Namen neu.
- Migration 0097 verschiebt bestehende offene Registrierungen in diese Form
  (ein gültiger Link gilt weiter). `verification_token` und `token_expires`
  werden nicht mehr benutzt. Nichts zu tun; die Android-App registriert
  unverändert (dieselbe Anfrage, dieselbe Antwort).

**2. Höchstens 50 Sitzungen und 50 Tokens je Konto**

- Bei jeder Anmeldung fallen über 50 hinaus die am längsten unbenutzten
  Browser-Sitzungen weg, ebenso bei jedem neuen Token die am längsten
  unbenutzten App-Tokens (ein gerade getauschter in seiner Überlappung zählt
  nicht). Ein so entferntes Gerät muss sich neu anmelden.
- Weiche Grenze: Nach 30 erfolgreichen Anmeldungen in 15 Minuten von
  derselben Adresse mit demselben Konto entfällt der Vorrang aus Abschnitt
  38.6; gesperrt wird nichts.

**3. Passwortprüfung in Worker-Threads**

- bcrypt rechnet nicht mehr im Hauptthread, sondern in höchstens so vielen
  Worker-Threads, wie die Schranke gleichzeitig zulässt (Kerne, mindestens
  2). Sie entstehen erst bei Bedarf; jeder kostet einige MB Speicher und
  einen Thread (innerhalb von `pids_limit` und `mem_limit` reichlich Platz).
  Startet ein Worker nicht, meldet das Protokoll `[bcrypt] Worker-Thread
  startet nicht …`, und geprüft wird wie bisher im Hauptthread.

**4. `backup.sh` bricht ab, statt unvollständig zu sichern**

- Vor dem Dump prüft das Skript, ob alles unter `data/` lesbar ist, und
  bricht sonst mit `data/ ist nicht vollständig lesbar (…)` und Exit 1 ab.
  Ein Fehler von `tar` (auch „Datei hat sich beim Lesen geändert“) beendet
  es ebenfalls mit Exit 1; das halbe Archiv wird entfernt.
- Das Skript muss als **root** oder unter der UID des Dienstes (`brickinv`)
  laufen, weil der Dienst seit Abschnitt 38.4 nur für sich lesbar schreibt.
  Wer es bisher unter einem Benutzer der Gruppe `docker` aufrief, bekommt
  jetzt diesen Fehler statt einer stillen Lücke: Cron-Eintrag auf root
  umstellen (`sudo crontab -e`, Beispiel im Kopf von `scripts/backup.sh`).

**5. `GET /api/v1/sets/info/:nummer` und fremde Platzhalter**

- Ein Katalog-Platzhalter („Set <Nummer>“ ohne Jahr, Thema und Teilezahl),
  den ein anderes Konto beim Erfassen einer unbekannten Nummer anlegte,
  antwortet wie eine nie erfasste Nummer (`im_katalog: false`). Eigene Sets,
  Sets des Haushalts und echte Katalogeinträge antworten wie bisher.

**6. Bewusst unverändert: Vergabeprüfung beim Ändern der Adresse**

- `PUT /profile` meldet weiter `email_vergeben`, wenn eine Adresse bestätigt
  einem anderen Konto gehört. Die Auskunft verlangt Anmeldung, Passwort und
  gegebenenfalls den zweiten Faktor und ist auf 10 je Stunde und Konto
  gebremst; eine stille Antwort liesse den Nutzer dagegen im Unklaren,
  warum seine Adresse nie gilt.

## 40. Runde 14 – Anmeldung hinter Caddy, Bestätigungslink, bcrypt-Pool

**1. Caddy reicht die Anmeldewege ohne Verbindungsgrenze weiter**

- Im Block `(anmeldung)` des `Caddyfile` entfällt `max_conns_per_host 4`
  (Abschnitt 33.5 gilt insoweit nicht mehr). Die Grenze stellte eine Flut aus
  vielen Adressen bei Caddy in eine Schlange ohne Ende, Frist und Vorrang;
  die Schranke des Servers (Vorrang bekannter Anmeldungen aus 38.6, 503
  `server_ausgelastet` bei Überlast) kam nie zum Zug.
- `max_size 16KB` und `request_buffers 32KB` bleiben: Überlange Rümpfe enden
  mit 413, langsame erreichen die App erst vollständig.
- Wer ein eigenes Caddyfile pflegt, streicht dort `transport http {
  max_conns_per_host … }` im Anmeldeblock ebenso. Unter einer Flut sehen
  Clients jetzt schneller 503 statt langer Wartezeit.

**2. Bestätigungsseite nennt das Konto des Links**

- Neu: `POST /api/v1/auth/email-bestaetigen/vorschau` mit `{ token }` antwortet
  `{ success: true, username }`, ohne den Link einzulösen (30 je Stunde und
  Adresse); ein ungültiger Link antwortet 400 `bestaetigungslink_ungueltig`.
- Die Seite `/verify` nennt vor dem Klick den Benutzernamen, angemeldet unter
  einem anderen Konto beide Namen; der Knopf heisst „Ja, „…“ ist mein Konto –
  bestätigen“ und ist bis dahin gesperrt.
- Nennen mehrere offene Registrierungen dieselbe Adresse, trägt die
  Bestätigungsmail einen Hinweis darauf (ohne Namen: Die Mail geht an eine
  unbestätigte Adresse und enthält keinen gewählten Text).
- Unverändert: Eine offene Registrierung meldet sich nicht an (39.1), kann
  also vor der Bestätigung auch keinen zweiten Faktor oder Passkey
  einrichten. Nichts zu tun.

**3. Höchstens 4 bcrypt-Arbeiter, untätige enden**

- Die Zahl der Worker-Threads und der gleichzeitigen Passwortprüfungen ist
  `min(Kerne, cgroup-CPU-Kontingent, 4)`, mindestens 2 (vorher: alle Kerne
  des Hosts, Abschnitt 39.3). Das Kontingent liest der Server aus
  `/sys/fs/cgroup/cpu.max` (v2) oder `cpu.cfs_quota_us` (v1); `cpus:` in
  `compose.yaml` wirkt so mit.
- Optional: `BCRYPT_ARBEITER=<1–64>` setzt die Zahl ausdrücklich (z. B. auf
  einem grossen Host mit vielen gleichzeitigen Anmeldungen); ein Wert
  ausserhalb davon hält den Start an. Jeder Arbeiter belegt gut 12 MB;
  `mem_limit` im Blick behalten.
- Ein Arbeiter ohne Auftrag endet nach 60 s und gibt seinen Speicher frei.

**4. Prüfung eines Haushaltscodes gebremst**

- `POST /api/v1/settings/household/redeem/pruefen` antwortet nach 30
  Prüfungen je Stunde und Konto mit 429 `zu_viele_anfragen`. Nichts zu tun.

## 41. Ein Image für app, jobs und schluessel, gezogen statt gebaut

`compose.yaml` nennt für `app`, `jobs` und `schluessel` jetzt dasselbe Image
`addict85/brickinventory:${BRICK_TAG:-latest}` (`pull_policy: missing`); nur
`app` hat noch `build:`.

- **Ohne weiteres Zutun** holt `docker compose up -d` beim ersten Mal das
  signierte Image von Docker Hub, statt lokal zu bauen. Danach bleibt es, bis
  `docker compose pull` eine neuere Fassung holt. Update also:
  `docker compose pull && docker compose up -d`.
- **Wer selbst baut** (eigene Änderungen am Quelltext), nimmt wie bisher
  `docker compose up -d --build`. Das Dockerfile wird dabei einmal gebaut,
  nicht dreimal; das Ergebnis trägt den Namen des veröffentlichten Images und
  gilt für alle drei Dienste, bis ein `pull` es ersetzt.
- **Fester Stand:** `BRICK_TAG=sha-1a2b3c4` (oder ein Datums-Tag) in `.env`.
- Die alten lokalen Images (`<ordner>-app`, `<ordner>-jobs`,
  `<ordner>-schluessel`) werden nicht mehr benutzt und können mit
  `docker image rm` weg.
- Das Passwort des ersten Verwalters steht beim allerersten Start im
  Protokoll von `app` oder `jobs` (wer zuerst migriert):
  `docker compose logs app jobs | grep -A2 Standard-Admin`. `ADMIN_PASSWORD`
  reicht `compose.yaml` nicht durch.

## 42. Runde 16 – Image nur als geprüfter Digest, Startverbot für Mail-Tokens

**Für jeden Docker-Betreiber einmal zu tun (Punkt 1).** Ohne diesen Schritt
bricht `docker compose` mit „BRICK_IMAGE fehlt in .env“ ab.

**1. Das App-Image kommt nur noch signaturgeprüft und als Digest**

`compose.yaml` zieht `app`, `jobs` und `schluessel` nicht mehr über den
veränderlichen Tag `latest`, sondern über `BRICK_IMAGE` aus `.env`, etwa
`BRICK_IMAGE=addict85/brickinventory@sha256:…`. Ein Tag lässt sich bei Docker
Hub umhängen, ein Digest nicht. Eintragen tut ihn das neue Skript:

```bash
sh scripts/image-pruefen.sh     # im Ordner mit compose.yaml
docker compose up -d
```

Das Skript:

- prüft mit `cosign verify` die Signatur des Tags aus `BRICK_TAG` (Vorgabe
  `latest`) gegen den Workflow `docker-publish.yml` auf `main`;
- übernimmt genau den Digest, den cosign geprüft hat, und schreibt ihn als
  `BRICK_IMAGE` in `.env` (eine alte Zeile `BRICK_IMAGE=` wird ersetzt, die
  Rechte der Datei bleiben);
- zieht danach `schluessel`, `app` und `jobs`. Scheitert die Prüfung, ändert
  es nichts.

**Update ab jetzt:** `sh scripts/image-pruefen.sh && docker compose up -d`
statt `docker compose pull && docker compose up -d`.

**cosign** muss auf dem Docker-Rechner installiert sein: über die
Paketverwaltung oder als einzelne Datei von
<https://github.com/sigstore/cosign/releases> (amd64 und arm64). Die Prüfung
braucht Zugang zu Docker Hub und zu Sigstore, aber nur beim Aufruf des
Skripts, nicht beim Start der Container.

**Ausnahmen, bewusst gesetzt:**

- **Selbst gebaut:** `BRICK_IMAGE=brickinventory:lokal` in `.env`, dann wie
  bisher `docker compose up -d --build`.
- **Ohne Prüfung** (nicht empfohlen): `BRICK_IMAGE=addict85/brickinventory:latest`
  von Hand eintragen. Dann gilt wieder der Tag wie vor dieser Runde.

**2. `MAIL_KONSOLE_MIT_TOKEN=1` verhindert den Start im Betrieb**

Mit `NODE_ENV=production` (Docker, `npm start`) startet der Server mit
`MAIL_KONSOLE_MIT_TOKEN=1` nicht mehr: Rücksetz- und Bestätigungslinks samt
Token landeten in `app_logs`, und jeder Verwalter liest sie dort. Die Zeile aus
`.env` entfernen. Auf einem Entwicklungsrechner (`NODE_ENV=development`) geht es
weiter.

`COOKIE_SECURE=0` bleibt im Betrieb erlaubt (README.md, „Ohne HTTPS“). Der
Server meldet es aber beim Start mit der Warnzeile `⚠️ [start] COOKIE_SECURE=0 …`.

**3. Bremse für Passwortbestätigungen auch je Konto (nichts zu tun)**

Neben den fünf Fehlversuchen je Zugang und Viertelstunde zählt der Server jetzt
höchstens 20 je Konto und Tag, über alle Sitzungen und App-Zugänge. Die Grenze
sperrt nur Zugänge, die selbst falsch geraten haben; eine eigene, saubere
Sitzung bestätigt weiter. Erreicht ein Zugang oder das Konto die Bremse, steht
`bestaetigung_gebremst` im Protokoll, und der Inhaber bekommt höchstens einmal
am Tag eine Mail.

**4. Signatur in der Pipeline (nichts zu tun)**

`docker-publish.yml` signiert den Digest aus der Ausgabe des Pushs
(`imagetools create --metadata-file`), nicht mehr den, auf den der Tag kurz
danach zeigt.

**5. Datenbankrolle (unverändert, zur Kenntnis)**

`brickinventory_app` bleibt Eigentümerin von Datenbank und Schema. Die App
migriert beim Start, und der Katalog-Import arbeitet mit Schattentabellen;
beides braucht Eigentümerrechte. Eine getrennte Migrationsrolle verlangt einen
eigenen Migrationsdienst und einen umgebauten Import. Das kommt in einer
eigenen Runde mit Anleitung.
