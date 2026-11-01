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

## 27. Runde 4 – Härtung

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
