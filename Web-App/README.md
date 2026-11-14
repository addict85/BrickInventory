# 🧱 BrickInventory Manager

Vollständige Node.js Webapp zur Verwaltung deiner Klemmbaustein-Sammlung.

## Features
- **Galerie** – Sets verwalten (einzeln oder per CSV), Bild, Name, Jahr, Thema
- **Teile-Übersicht** – alle Teile aller Sets, gruppiert nach Farbe, filterbar
- **Finanzen** – Marktwert via BrickLink Preisführer
- **Einstellungen** – Benutzerverwaltung, API-Keys, Währung
- **Anleitungen** – automatisch von Brickset heruntergeladen (PDF, lokal gespeichert)
- **Login** – eigene Bibliothek pro Benutzer

## Docker (empfohlen)

Im Ordner mit `compose.yaml`, Schritt für Schritt:

```bash
cp .env.example .env
echo BRICK_HOST=nas.example.lan >> .env   # Name oder IP-Adresse des Servers
echo VORGELAGERTER_PROXY=keiner >> .env   # oder die Adresse eines Proxys davor (README, „Proxy vor Caddy“)
sh scripts/geheimnisse-einrichten.sh      # Sitzungsgeheimnis und DB-Passwörter nach ./geheimnisse/
sudo sh scripts/ca-einrichten.sh          # eigene CA, die nur für BRICK_HOST gilt (siehe unten)
sh scripts/image-pruefen.sh               # Signatur prüfen, Image als Digest in .env, pull (braucht cosign)
docker compose up -d
docker compose exec app cat /app/data/admin-startpasswort.txt   # Erstpasswort von admin
```

Danach unter `https://<BRICK_HOST>` (Port 80 leitet auf HTTPS um). Was dabei
entsteht und warum:

1. **`.env`** braucht `BRICK_HOST`: den Namen oder die IP-Adresse, unter
   der Geräte den Server erreichen (für Passkeys ein Name), und
   `VORGELAGERTER_PROXY`: `keiner` oder die Adresse eines Proxys vor Caddy
   (Abschnitt „Proxy vor Caddy“). Alle anderen Variablen haben Vorgaben
   (`.env.example`).
2. **`./geheimnisse/`** (Ordner 700) hält Sitzungsgeheimnis und Passwörter als
   Dateien; `compose.yaml` hängt sie als Docker-Secrets unter `/run/secrets/`
   ein, `docker inspect` zeigt sie so nicht. In `.env` gehören sie nicht.
3. **`./caddy/ca/`** hält die eigene CA (Abschnitt unten). Ohne sie startet
   Caddy nur mit `BRICK_TLS=acme` (öffentlicher Name, Let's Encrypt) oder dem
   ausdrücklichen Schalter `CA_OHNE_NAMENSBESCHRAENKUNG=ja` (UPGRADE.md,
   Abschnitt 33). Die App selbst veröffentlicht keinen Port.
4. **Das Image** `addict85/brickinventory` gilt für `app`, `jobs` und
   `schluessel`. `scripts/image-pruefen.sh` prüft mit `cosign verify` die
   Signatur des Tags (`BRICK_TAG`, Vorgabe `latest`), trägt den geprüften
   Digest als `BRICK_IMAGE` in `.env` ein und zieht ihn; ohne `BRICK_IMAGE`
   startet compose nicht. cosign muss dafür installiert sein (UPGRADE.md,
   Abschnitt 42). Ebenso prüft es `addict85/brickinventory-caddy` und trägt
   es als `CADDY_IMAGE` ein (Abschnitt 52). Wer selbst baut, setzt
   `BRICK_IMAGE=brickinventory:lokal` und `CADDY_IMAGE=brickinventory-caddy:lokal`
   und nimmt `docker compose up -d --build`.
5. **Das Konto `admin`** bekommt beim allerersten Start ein Zufallspasswort,
   das nur in diesem Protokoll steht und bei der ersten Anmeldung geändert
   werden muss. Den ersten Start macht der Dienst `migration`
   (`docker compose logs migration`).

**Update:** `sh scripts/image-pruefen.sh && docker compose up -d` (selbst gebaut:
`docker compose up -d --build`). Vorher `UPGRADE.md` lesen; die Abschnitte
stehen in zeitlicher Reihenfolge.

### HTTPS mit eigener CA (Caddy)

Vor der App steht Caddy (`compose.yaml`, `Caddyfile`). Er macht TLS mit einer
eigenen, lokalen CA (`tls internal`) für `BRICK_HOST` und leitet an die App
weiter; die App selbst veröffentlicht keinen Port mehr. Caddy kommt aus
`Dockerfile.caddy` (offizielle Basis per Digest, Go-Module nachgezogen),
gebaut und signiert wie das App-Image (`CADDY_IMAGE`, Abschnitt 52 in
UPGRADE.md); selbst gebaut dauert es einige Minuten. Die CA liegt unter
`./caddy/data/` — mitsichern. Der App-Container sieht davon nur das öffentliche
Wurzelzertifikat (Volume `ca-wurzel`), nie den Schlüssel der CA.

Damit Browser und Telefone dem Zertifikat vertrauen, kommt das
**Wurzelzertifikat** einmal auf jedes Gerät: Es liegt unter
`https://<BRICK_HOST>/ca.crt` (auch über `http://`, ohne Umleitung). Über
HTTP kann es unterwegs ausgetauscht werden; **vor dem Installieren den
SHA-256-Fingerabdruck auf dem Gerät mit dem auf dem Server vergleichen**
(`docker compose logs caddy | grep Fingerabdruck` oder die Ausgabe von
`scripts/ca-einrichten.sh`). Er steht auch in den Einstellungen unter „Sicherheit“; die
Android-App braucht das nicht: Sie pinnt den Fingerabdruck aus dem QR-Code und
vertraut der Wurzel ohne systemweite Installation. Schritt für
Schritt: `UPGRADE.md`, Abschnitt 14.

**Das Risiko der Wurzel und die beschränkte CA.** Ein installiertes
Wurzelzertifikat gilt auf dem Gerät für jede Adresse, die es nicht
ausdrücklich ausschliesst. Caddys eigene CA schliesst nichts aus: Wer ihren
Schlüssel aus `./caddy/data/` oder einer Sicherung davon bekommt, stellt
Zertifikate für Bank und Mail aus, denen jedes Gerät mit dieser Wurzel
traut. Deshalb vor dem ersten Start `sudo sh scripts/ca-einrichten.sh`: Es legt
unter `./caddy/ca/` eine Wurzel an, die nur für `BRICK_HOST` gilt (Name
Constraints; bei einem Namen sind IP-Adressen ganz ausgeschlossen), und eine
Zwischenstelle (rund zehn Jahre), mit der Caddy signiert. Den Schlüssel der
Wurzel verwirft das Skript; wer ihn behalten will, gibt mit
`sudo WURZEL_SCHLUESSEL=/media/usb/wurzel.key sh scripts/ca-einrichten.sh` einen Ort ausserhalb des Servers
an. Auf dem Server liegt dann nur der Schlüssel der Zwischenstelle
(`./caddy/ca/zwischen.key`, wie ein Passwort behandeln); auch er taugt nur
für `BRICK_HOST`. Ohne `./caddy/ca/` startet Caddy nicht — ausser mit
`BRICK_TLS=acme` (ein öffentlicher Name, Zertifikat von Let's Encrypt, keine
eigene Wurzel auf den Geräten) oder ausdrücklich mit
`CA_OHNE_NAMENSBESCHRAENKUNG=ja` (Caddys unbeschränkte CA). Umstieg einer bestehenden Installation: `UPGRADE.md`,
Abschnitt 32.

### Proxy vor Caddy

Die Kette ist **Client → (eigener Proxy) → Caddy → App**. Die App glaubt
`X-Forwarded-For` nur Caddy (`TRUST_PROXY`, feste Adresse `172.28.73.10`);
Caddy gibt ihr genau eine Adresse weiter: die des Clients, wie er sie sieht.
Steht davor ein weiterer Proxy, etwa **Nginx Proxy Manager**, sieht Caddy
ohne weitere Angabe nur dessen Adresse. Dann teilen sich alle Clients eine
Adresse: Fehlversuche eines Fremden sperren alle aus, Registrierung und
„Passwort vergessen“ sind für alle zusammen gedrosselt.

Deshalb ist `VORGELAGERTER_PROXY` in `.env` eine Pflichtangabe; ohne sie
startet Caddy nicht und sagt, was fehlt. Zwei Möglichkeiten:

```
VORGELAGERTER_PROXY=keiner          # Caddy ist direkt erreichbar (Ports 80/443)
VORGELAGERTER_PROXY=172.28.73.20    # Adresse des Proxys davor, wie Caddy sie sieht
```

Mehrere Adressen stehen durch Leerzeichen getrennt. Mit einer Adresse glaubt Caddy nur ihm `X-Forwarded-For` und liest es von rechts; ein
Client kann sich keine Adresse voranstellen. `TRUST_PROXY` bleibt, wie es ist.
Am sichersten hängt der Proxy mit fester Adresse im Netz `brickinventory-net`
(`ipv4_address`, wie Caddy) und leitet an `https://caddy:443` weiter. Läuft er
auf einem anderen Rechner, dessen feste LAN-Adresse. **Nie** das
Docker-Gateway (`172.x.0.1`) oder ein ganzes Netz eintragen: Über das Gateway
kommen auch Clients selbst herein und könnten sich jede Adresse geben. Netze
über 8 Adressen (weiter als `/29`, IPv6 `/120`) nimmt Caddy nur mit
`PROXY_NETZ_BESTAETIGT=1` in `.env`. Der
Proxy muss `X-Forwarded-For` setzen (bei Nginx Proxy Manager die Vorgabe).

Kommen über eine Stunde und mindestens 300 Anfragen alle mit derselben
Client-Adresse an, meldet die App im Protokoll `[sicherheit] Seit … Minuten
kommen alle … Anfragen … mit derselben Client-Adresse` — meist genau dieser Fall
(etwa `keiner` eingetragen, obwohl ein Proxy davor steht). Verwalter sehen
denselben Hinweis unter **Hintergrundarbeiten**. Wer sich von einem Gerät schon
angemeldet hat, wird von Fehlversuchen Fremder über dieselbe Adresse nicht
ausgesperrt.

### Ohne HTTPS (bewusste Ausnahme)

Wer ohne TLS betreiben will (etwa zum Ausprobieren auf `localhost`), nimmt in
`compose.yaml` beim Dienst `app` die Zeilen `ports:` ein und setzt in `.env`
`COOKIE_SECURE=0` und `APP_BASE_URL=http://…`. Passwort, Sitzung und App-Token
gehen dann lesbar durchs Netz; „Unbegrenzt“ beim QR-Code und Passkeys gibt es
dann nicht. Browser erreichen den Server dann nur unter dem Namen aus
`APP_BASE_URL` (oder `localhost`); ein anderer Name oder die blosse IP-Adresse
bekommt 421 (UPGRADE.md, Abschnitt 35).

### Pfade anpassen

```yaml
volumes:
  - /mnt/data:/app/data   # eigener Datenpfad — enthält auch alle Bilder
```

Bilder brauchen **kein eigenes Volume**: Sie liegen unter `data/images/`
(Sets in `data/images/sets/`, Teile in `data/part_images/`), Vorschaubilder
jeweils als `<name>_thumb.jpg` daneben. Ein Backup von `data/` erfasst damit
alles.

### Datenbankpasswörter
`scripts/geheimnisse-einrichten.sh` legt in `./geheimnisse/` je eine Datei an:
`db_password` (Superuser `brickinventory`, nur `postgres` und `db-rolle`),
`db_app_password` (Laufzeitrolle `brickinventory_app`, mit der sich App und
Jobs verbinden: nur Zeilen lesen und schreiben), `db_migration_password`
(Migrationsrolle `brickinventory_migration`, Eigentümerin von Datenbank und
Tabellen, nur im Dienst `migration`), `db_system_password` (Systemrolle
`brickinventory_system` für App und Jobs: dieselben Rechte wie die
Laufzeitrolle, aber am Zeilenschutz vorbei, für Aufträge, Verwaltung und
Anmeldung), `session_secret` und das der Leserolle.
Vorhandene Dateien bleiben; fehlende übernimmt es aus einer alten `.env`
(`DB_PASSWORD`, `DB_APP_PASSWORD`, `SESSION_SECRET`) oder
erzeugt sie zufällig. Eine **bestehende** Datenbank behält ihr Passwort aus dem
ersten Start: Liegt `./pgdata18` schon da und steht kein `DB_PASSWORD` in
`.env`, bricht das Skript ab, statt ein unpassendes zu erzeugen. `db-rolle`
setzt die Passwörter von Laufzeit-, System- und Migrationsrolle bei jedem
`docker compose up` neu; zum Wechseln genügt es, die Datei zu ersetzen.

Läuft die Datenbank noch mit dem alten Beispielpasswort `brickinventory_secret`,
verweigert der Server in Produktion den Start. Ändern: `docker compose exec
postgres psql -U brickinventory -c "ALTER USER brickinventory PASSWORD
'neues-passwort'"`, dann den Wert in `geheimnisse/db_password` schreiben
(`printf %s 'neues-passwort' > geheimnisse/db_password`) und `docker compose up
-d` ausführen.

### Web- und Job-Prozess
`compose.yaml` startet zwei Dienste aus demselben Bau: `app` (`ROLLE: web`)
beantwortet Anfragen, `jobs` (`ROLLE: jobs`) arbeitet die Hintergrundarbeit
ab — Preise, Anleitungen, Bilder, PDF, Importe, Katalogabgleich, Aufräumen.
Alles davon steht als Auftrag in der Tabelle `auftraege`, auch die Zeitpläne;
„Monitoring → Hintergrundarbeiten“ zeigt sie samt Fehlern und lässt sie
abbrechen, wiederholen oder vorziehen. Ohne Compose (`npm start`) gilt
`ROLLE=beides`: ein Prozess für alles. Ein Update von einer Fassung mit
Cluster beschreibt UPGRADE.md, Abschnitt 15.

### DB-Pool-Größe anpassen
Normalerweise **nicht nötig**: Jeder Prozess hält höchstens 15 Verbindungen,
`app` und `jobs` zusammen also 30. Nur wenn die PostgreSQL-Instanz ein
kleines `max_connections` hat, in `compose.yaml` (bei beiden Diensten):
```yaml
environment:
  PG_POOL_MAX: 40   # mehr parallele Verbindungen
```

## Manuell starten (ohne Compose)

```bash
npm ci --ignore-scripts && npm rebuild esbuild   # exakt die Lockfile, Install-Skripte nur für esbuild
npm run build      # .ts → dist/, Frontend → public/js/app.bundle.js (Erzeugnis, nicht in git)
npm start          # → node dist/server.js, NODE_ENV=production
# → http://localhost:3000  (PostgreSQL muss separat laufen)
```

`npm start` verlangt wie im Betrieb `SESSION_SECRET` (mindestens 32 Zeichen),
`APP_BASE_URL` und eine Datenbank. Die Verbindung kommt aus `DATABASE_URL`
oder aus `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`; ohne beides
ist der Host `postgres`, den es nur im Compose-Netz gibt.

## Lokal entwickeln

```bash
# PostgreSQL 18 lokal (eigene Installation oder ein Container mit veröffentlichtem Port)
export DATABASE_URL=postgres://bim:geheim@127.0.0.1:5432/bim
npm ci --ignore-scripts && npm rebuild esbuild
npm run dev        # baut das Bündel, startet den Server mit tsx watch (NODE_ENV=development)
# → http://localhost:3000, Konto `admin`: Passwort aus ADMIN_PASSWORD oder in data/admin-startpasswort.txt
```

Ohne `npm run dev` geht es auch gebaut: `npm run build`, dann
`NODE_ENV=development node dist/server.js`. In der Entwicklung sind
`SESSION_SECRET` und `APP_BASE_URL` nicht Pflicht.

## Entwickeln

```bash
npm run dev             # tsx watch, baut das Frontend-Bündel selbst
npm run typecheck       # Server; :frontend Oberfläche, :tests Tests (Ratsche)
npm run lint            # Biome, Ratsche: Funde dürfen nur weniger werden
npm run format:pruefen  # Biome, Ratsche: nicht formatierte Dateien
npm test                # siehe „Tests“
npm run check-contract  # Vertrag gegen einen laufenden Server (BASE_URL), nur von Hand
```

Lint und Format sind Ratschen (`scripts/lint-schranken.json`): Neuer Code ist
sauber und formatiert (`npx biome format --write <datei>`), der Bestand wird
nach und nach nachgezogen. Den Bestand auf einmal formatiert `npm run
format:alles`; danach `format` in `scripts/lint-schranken.json` auf 0 setzen,
den Commit-Hash in `.git-blame-ignore-revs` (Wurzel) eintragen und
`git config blame.ignoreRevsFile .git-blame-ignore-revs` empfehlen.

**Fassungen.** Massgeblich ist, was ausgeliefert und in der CI geprüft wird:

| | Image (`Dockerfile`, `compose.yaml`) | CI (`web-ci.yml`) | lokal |
|---|---|---|---|
| Node | 26 | 26 | `.nvmrc` nennt 26 (`nvm use`) |
| PostgreSQL | 18 | 18 (Dienst), `pg_dump` 18 | auch 16 läuft; `db-rolle-db` braucht `psql` ab 15, `backup-restore-db` ein `pg_dump` in der Hauptversion des Servers |

Ein lokaler Lauf mit einer älteren Fassung (etwa Node 22, PostgreSQL 16) ist
eine Plausibilisierung; ein Unterschied zwischen den Hauptversionen zeigt sich
erst in der CI. `test/build-tooling.test.js` hält Dockerfile, CI, `.nvmrc` und
`@types/node` auf derselben Node-Hauptversion.

Nach Änderungen an `public/js/*` oder `public/i18n.js` muss
`npm run build:frontend` laufen — der Server liefert das gebündelte
`app.bundle.js` aus, nicht die Einzeldateien. Das Bündel liegt nicht in git:
`npm run build`, `npm run dev`, `npm test` und der Docker-Bau erzeugen es, und
ein einzelner `node --test test/<datei>` baut es selbst, wenn es fehlt oder
älter als die Quellen ist.

## Sicherung

```bash
./scripts/backup.sh            # pg_dump + data/ nach ./backups, mit age verschlüsselt
```
Sicherungen sind **immer verschlüsselt**: Die öffentlichen age-Schlüssel der
Empfänger stehen in `./backup-empfaenger.txt` (einer je Zeile); der private
Schlüssel liegt auf einem anderen Rechner und wird nur zum Wiederherstellen
gebraucht (`BACKUP_AGE_IDENTITAET=… ./scripts/restore.sh …`). Ohne Empfänger
sichert das Skript nichts, ausser mit ausdrücklichem `BACKUP_KLARTEXT=ja`.
Einrichten: UPGRADE.md, Abschnitt 33.
Ein Dateikopie-Backup von `pgdata/` bei laufendem PostgreSQL ist **wertlos**.

**Regelmässig sichern** — der Server tut es nicht von selbst. Ein Eintrag in
der crontab des Rechners (`crontab -e`), täglich um 3:10 Uhr:
```
10 3 * * * cd /opt/brickinventory && ./scripts/backup.sh >> backups/backup.log 2>&1
```
Ältere Sicherungen als `BACKUP_KEEP_DAYS` (Standard 30) räumt das Skript selbst weg.

**Das Wiederherstellen einmal ausprobieren**, solange nichts passiert ist —
eine Sicherung, die sich nicht einspielen lässt, merkt man sonst erst im
Ernstfall: `./scripts/restore.sh <db_….sql.gz> <data_….tar.gz>` auf einer
Testinstallation (eigenes Verzeichnis, eigene `compose.yaml`), danach
anmelden und eine Sammlung durchsehen.

Dump und `data/`-Archiv entstehen nacheinander, nicht im selben Augenblick.
Wer während der Sicherung ein Bild oder eine Anleitung hochlädt, findet nach
dem Wiederherstellen schlimmstenfalls eine Datei ohne Eintrag oder einen
Eintrag ohne Datei; die Sammlung selbst ist davon nicht betroffen. Nachts
gesichert, kommt das praktisch nicht vor.

**Sicherungen sind Geheimnisse.** API-Schlüssel, SMTP-Passwort,
Gutscheinnummern und -PINs und die Geheimnisse des zweiten Faktors liegen verschlüsselt im
Dump; der Schlüssel dazu steht in `schluessel/datenschluessel` (ältere Installationen: `data/.datenschluessel`, siehe UPGRADE.md Abschnitt 21; oder in `DATA_KEY`).
**Diese Datei mitsichern, aber getrennt vom Dump** — ohne sie lassen sich die
Werte nach einer Wiederherstellung nicht mehr lesen und müssen neu eingegeben
werden; Konten mit zweitem Faktor kommen dann nicht mehr herein. `backup.sh`
lässt sie deshalb aus dem `data/`-Archiv weg und legt sie nur mit
`BACKUP_SCHLUESSEL_ZIEL=/anderer/ort` dort ab (etwa ein USB-Stick oder ein
anderes Laufwerk als das der Sicherungen); ohne die Angabe meldet es bei jedem
Lauf, dass der Schlüssel fehlt. `restore.sh` fragt nach, bevor es ohne
`schluessel/datenschluessel` neu startet. Die Passwort-Hashes stehen trotzdem im Dump. `backup.sh` legt die Dateien deshalb nur für den
Besitzer lesbar an (`umask 077`) und warnt, wenn das Zielverzeichnis für
andere offen ist.

### Automatische Kopie vor einem Update

Bringt ein Update neue Migrationen mit, kopiert der Server vorher alle
Tabellen mit Nutzerdaten (`users`, jede Tabelle mit `user_id` und jede mit Fremdschlüssel auf `users`, etwa die Haushaltsverknüpfungen) in ein
eigenes Schema `vor_migration_<Datum Uhrzeit>` derselben Datenbank. Die drei
jüngsten bleiben, keine länger als 30 Tage; ein gelöschtes Konto verschwindet
auch aus ihnen, und `backup.sh` nimmt sie nicht mit. Das ersetzt `backup.sh` nicht — Katalog und Bilder fehlen
darin —, aber ein misslungenes Update lässt sich damit zurücknehmen:

```bash
docker compose exec postgres psql -U brickinventory -c '\dn vor_migration_*'
# eine Tabelle zurückholen, z. B. die Set-Erfassungen:
docker compose exec postgres psql -U brickinventory -c "
  BEGIN;
  DELETE FROM set_acquisitions;
  INSERT INTO set_acquisitions SELECT * FROM vor_migration_20261027190312345.set_acquisitions;
  COMMIT;"
```

Hat die Migration Spalten der Tabelle geändert, im `INSERT` die Spalten
ausdrücklich nennen (`INSERT INTO t (a, b) SELECT a, b FROM …`).

## Manuell erfasste Teile löschen

Aufräumen nach einem schiefgegangenen Import — zwei Anweisungen, kein Skript:

```bash
docker exec -i brickinventory-db psql -U brickinventory -d brickinventory <<'SQL'
BEGIN;
-- 1. Die Kaufpreis-Erfassungen ZUERST. part_acquisitions hat keine Spalte
--    source; welche Erfassung zu einer MANUELL erfassten Position gehört,
--    sagt nur die Bestandszeile. Ist die zuerst weg, bleiben die Kaufpreise
--    liegen und zählen in den Finanzsummen weiter mit.
DELETE FROM part_acquisitions a
 WHERE EXISTS (SELECT 1 FROM parts p
                WHERE p.user_id = a.user_id AND p.part_number = a.part_number
                  AND COALESCE(p.color_id, 0) = COALESCE(a.color_id, 0)
                  AND p.source = 'manual'
                  AND p.part_number NOT IN ('31000', '31001'));
-- 2. Dann die Bestandszeilen. `source = 'manual'` ist die Eintrittskarte:
--    Teile AUS Sets hängen am Set und verschwinden mit ihm.
DELETE FROM parts
 WHERE source = 'manual' AND part_number NOT IN ('31000', '31001');
COMMIT;
SQL
```
Die Nummern in den beiden `NOT IN`-Listen **bleiben** stehen. Vorher
`./scripts/backup.sh` — Löschen lässt sich nicht zurücknehmen; zum Nachsehen
`BEGIN;` … `ROLLBACK;` statt `COMMIT;` laufen lassen, die Zeilenzahlen kommen
trotzdem.

Nicht angetastet werden die Kataloge (`part_catalog`, `part_color_catalog`,
`bl_zuordnung`, Preis-Cache und -Verlauf): Sie gelten für alle Konten und für
Set-Teile, und jede Zeile darin hat einmal einen API-Abruf gekostet.

Ein Hinweis zum Vergleich: Die Anweisungen prüfen die **Rebrickable**-Nummer.
Auf der Kachel steht die BrickLink-Nummer, wenn sie abweicht — wer „31000" von
einer Kachel abliest, deren Teil intern `3002` heisst, muss `3002` eintragen
(`SELECT rb_id, bl_id FROM bl_zuordnung WHERE art='part'` zeigt die
Abweichungen).

## Datenbank ansehen

Ein Werkzeug im Browser gibt es nicht mehr (pgweb lief auf Debian 11 ohne
Pflege). Zum Nachsehen dient `psql` im Postgres-Container, am besten als
Leserolle `brickinventory_lesen`: nur `SELECT`, ohne Passwort-Hashes, Tokens,
Sitzungen, Schlüssel des zweiten Faktors und Einstellungswerte.

```bash
PGWEB=ja sh scripts/geheimnisse-einrichten.sh   # einmal: Passwort der Leserolle
docker compose up -d db-rolle                    # setzt es
docker compose exec postgres psql -h 127.0.0.1 -U brickinventory_lesen -d brickinventory
```

Das Passwort steht in `./geheimnisse/pgweb_db_password` (der Name stammt aus
der Zeit von pgweb). Was die Leserolle sieht, steht als Allowlist je Tabelle in
`postgres/app-rolle.sh` (`LESEN_SPALTEN`). Reparaturen an Zeilen gehen mit
`psql` als `brickinventory_app`, am Schema nur als `brickinventory_migration`.

## Empfohlene Umgebungsvariablen

| Variable | Wirkung |
|---|---|
| `APP_BASE_URL` | Die Adresse, unter der der Server von **aussen** erreichbar ist (z. B. `https://lego.example.org`). Sie steckt in den Links der E-Mails und im **QR-Code zur Verknüpfung der App**. Ohne sie gehen **keine Links per Mail** hinaus (die Adresse wird nie aus dem Host-Header abgeleitet — ein gefälschter bekäme sonst den Reset-Link), Passwort-vergessen antwortet 503; der QR-Code wird **gar nicht erst erzeugt** — er trüge sonst die Adresse aus der Browserzeile, und die App fände den Server ausserhalb des Heimnetzes nie wieder. Ist sie gesetzt, antwortet die App nur unter diesem Namen (sonst 421; frei bleiben `localhost`, App-Token, `/ca.crt` und die Gesundheitspfade). |
| `APP_BASE_URL_FEHLT_OK` | Nur `1`: Im Betrieb (`NODE_ENV=production`) startet der Web-Prozess ohne `APP_BASE_URL` sonst nicht, weil der Host-Filter fehlte. `compose.yaml` setzt `APP_BASE_URL` immer. |
| `TRUST_PROXY` | Wem der Server `X-Forwarded-For`/`-Proto` glaubt — nur **ausdrücklich genannten** Adressen. `compose.yaml` setzt die feste Adresse von Caddy (`172.28.73.10`). Ohne Angabe (ausserhalb von Compose) **nur Loopback** (`127.0.0.0/8`, `::1`). Steht ein Proxy davor, seine **feste** Adresse eintragen: im Compose-Netz `brickinventory-net` (`172.28.73.0/24`) z. B. `172.28.73.10` per `ipv4_address`, auf einem anderen Rechner z. B. `192.168.1.5`. Mehrere durch Komma; Netze nur bis 8 Adressen (IPv4 ab `/29`, IPv6 ab `/120`), weitere bis `/16` bzw. `/64` nur mit `PROXY_NETZ_BESTAETIGT=1` (gilt auch für `VORGELAGERTER_PROXY`). `false` schaltet es ganz ab. `docker`, `true` und Hop-Zahlen verweigern den Start: Damit könnte jeder Container oder Client im Netz seine Absenderadresse selbst angeben und die Anmeldesperre umgehen. |
| `VORGELAGERTER_PROXY` | Pflicht mit `compose.yaml`, nur für Caddy: `keiner` (Caddy direkt erreichbar, glaubt keinem `X-Forwarded-For`) oder die Adresse(n) eines Proxys **vor** Caddy (z. B. Nginx Proxy Manager), durch Leerzeichen getrennt. Siehe „Proxy vor Caddy“. |
| `UPLOAD_KONTINGENT_MB` | Wie viel Platz eigene Anleitungen (PDF/JPG/PNG) je Konto belegen dürfen, in MB (Vorgabe `2048`). Der Inhalt jeder Datei wird geprüft; eine Datei, deren Inhalt nicht zum Typ passt, wird abgewiesen. |
| `DATA_KEY` | Schlüssel (32 Byte, Base64) für die verschlüsselten Geheimnisse in der Datenbank: `openssl rand -base64 32`. Geht `DATA_KEY_FILE` vor. |
| `DATA_KEY_FILE` | Datei mit dem Schlüssel, ausserhalb von `data/` (compose.yaml: `/app/schluessel/datenschluessel`, Vorgabe `<APP_ROOT>/schluessel/datenschluessel`). Fehlt sie, legt der erste Start sie an (nur für den Besitzer lesbar). |
| `ADMIN_PASSWORD` | Passwort des beim ersten Start angelegten Admins (nur `npm start`; `compose.yaml` reicht es nicht durch). Sonst wird ein Zufallspasswort erzeugt und in `data/admin-startpasswort.txt` (Rechte 0600) abgelegt; das Log nennt nur den Pfad, die Datei verschwindet mit dem ersten Passwortwechsel. |
| `SESSION_SECRET` | Pflicht in Produktion (der Start bricht sonst ab). Mit Docker als Datei: `SESSION_SECRET_FILE` (setzt `compose.yaml`). |
| `NODE_ENV` | Nur `development` und `test` lockern die Regeln (Startverbote, Superuser-Verbot, Fehlertexte, sicheres Cookie). **Ohne Angabe gelten die Regeln des Betriebs** wie mit `production`. |
| `PGSSLMODE` | TLS zur Datenbank. Liegt sie auf einem anderen Rechner (nicht `postgres`, nicht Loopback), `verify-full` setzen (oder `sslmode=verify-full` in `DATABASE_URL`); sonst warnt der Start mit `[datenbank]`. |
| `DATA_KEY_ALT_FILE` | Nur während eines Schlüsselwechsels: der vorige Datenschlüssel (`scripts/datenschluessel-wechseln.sh`, UPGRADE.md Abschnitt 43). |
| `MAIL_KONSOLE_MIT_TOKEN` | Ohne SMTP schreibt der Server jede Mail ins Log, den Link darin **ohne Token** — das Log sieht jeder Verwalter, und ein Rücksetz-Link ist ein Zugang zum Konto. Die Empfängeradresse steht dort maskiert (`m…@example.org`). `1` zeigt den vollständigen Link und die volle Adresse, etwa auf einem Entwicklungsrechner ohne Mailserver. Mit `NODE_ENV=production` verweigert der Server damit den Start. |
| `BRICK_HOST` | Name oder IP-Adresse des Servers für Caddy (Pflicht mit `compose.yaml`). Ohne `APP_BASE_URL` gilt `https://BRICK_HOST`. Passkeys brauchen einen Namen, keine IP-Adresse. |
| `CA_ZERTIFIKAT` | Pfad zum Wurzelzertifikat der internen CA (setzt `compose.yaml`). Daraus kommen `/ca.crt` und der Fingerabdruck `fp` im QR-Code. |
| `TOKEN_IDLE_DAYS` | Tage ohne Nutzung, nach denen ein Gerätezugang (Token) verfällt (Vorgabe `90`, mindestens `1`). Jede Nutzung schiebt die Frist nach; geschrieben wird höchstens einmal je Tag. Ohne Ablauf gibt es nur die Wahl „Unbegrenzt“ beim QR-Code, nur über HTTPS und mit Rotation. |
| `SESSION_IDLE_MINUTES` | Minuten ohne Betrieb, nach denen eine **Webapp-Sitzung** abgemeldet wird (Vorgabe `240`, also vier Stunden). Betrifft nur den Browser — die Android-App kommt mit Bearer-Token und ohne Cookie, für sie gilt `TOKEN_IDLE_DAYS`. Die Frist GLEITET: Solange jemand arbeitet, läuft sie nicht ab; sie zählt ab der letzten Anfrage. `0` schaltet die Frist **nicht** ab. |
| `SESSION_MAX_HOURS` | Stunden ab der Anmeldung, nach denen eine **Webapp-Sitzung** endet, auch wenn sie benutzt wird (Vorgabe `168`, eine Woche). Anders als `SESSION_IDLE_MINUTES` gleitet diese Frist nicht. Ein ungültiger Wert fällt mit einer Logzeile auf die Vorgabe zurück. |

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
export TEST_DATABASE_URL=postgres://tester:tester@127.0.0.1:5432/cattest
REQUIRE_DB=1 npm test                         # ganze Suite, parallel
REQUIRE_DB=1 npm test -- test/ratschen.test.js   # einzelne Dateien, gleicher Aufbau
npm run test:seriell                          # alles nacheinander auf der Basis-DB
```

`npm test` (`scripts/test-lauf.js`) baut einmal nach `dist/`, legt aus
`TEST_DATABASE_URL` eine Vorlage-Datenbank `<name>_vorlage` an (Basis und
Migrationen) und gibt jeder Testdatei eine eigene Kopie davon. Die Dateien
laufen parallel (`TEST_PARALLEL`, Vorgabe doppelte Kernzahl, höchstens 8),
Browser-Tests und Dateien mit der Marke `@einzeln` danach einzeln. Was die
Suite an Datenbanken und Rollen anlegt, heisst `<name>_vorlage_…`; der nächste
Lauf räumt Reste davon ab. Der Benutzer der Test-DB braucht `CREATEDB`, einige
Dateien (Datenbankrolle, Sicherung) Superuser-Rechte.

| Variable | Wirkung |
|---|---|
| `TEST_DATABASE_URL` | Basis-Datenbank. Ohne sie laufen nur die Tests ohne Datenbank. |
| `REQUIRE_DB=1` | Eine fehlende Datenbank (oder fehlende Rechte, `psql`, `pg_dump`) ist ein Fehler statt eines Überspringens. In der CI gesetzt. |
| `REQUIRE_BROWSER=1` | Dasselbe für Chrome: Ohne Browser schlagen die Browser-Tests fehl, statt still zu überspringen. In der CI gesetzt. |
| `CHROME_BIN` | Pfad zu Chrome/Chromium, falls nicht unter `/usr/bin/google-chrome` oder `/usr/bin/chromium`. |
| `CADDY_BIN` | Pfad zu `caddy` für die Caddyfile-Tests; ohne ihn übersprungen. |
| `REQUIRE_CADDY=1` | Ein fehlender Caddy ist ein Fehler. In der CI gesetzt (Caddy aus dem Image in `compose.yaml`). |
| `TEST_PARALLEL_BROWSER` | Browser-Dateien gleichzeitig (Vorgabe 1; je Datei eigene Datenbank, Port und Chrome-Profil). In der CI 2. |
| `TEST_NACHLAUF=aus` | Eine Fristüberschreitung ist rot. Sonst läuft die Datei einzeln nach und erscheint als Warnung am Ende des Laufs. |

Ohne `REQUIRE_DB=1` und `REQUIRE_BROWSER=1` ist ein grüner Lauf kein Beleg:
Die betroffenen Dateien überspringen sich dann selbst.

**Aufbau** (flach in `test/`; die Zahlen nennt `ls test/*.test.js` bzw. die Ratschen):

| Art | Woran erkennbar |
|---|---|
| mit Datenbank | Name endet auf `-db.test.js` |
| im echten Chrome (Layout, Tastatur, CSP) | Name endet auf `-browser.test.js`, `helpers/app-browser` |
| Oberfläche in jsdom | `helpers/oberflaeche` (Antworten gegen den API-Vertrag geprüft) |
| liest nur Quelltext (Struktur, Verbote) | Ratschen in `test/ratschen.test.js`, dürfen nur sinken |

**Abdeckung:** `npm run abdeckung` (= `npm test -- --abdeckung`) misst Server
(`dist/`) und Oberfläche (über ein Mess-Bündel mit Sourcemap bis `public/js/`)
und schreibt `coverage/lcov.info`, `coverage-summary.json` und
`coverage/bereiche.json`. `node scripts/abdeckung.js pruefen` vergleicht die
Bereiche mit `scripts/abdeckung-schranken.json`; die CI macht beides.

Die API gibt es nur unter `/api/v1/`. Ihr Vertrag (zod-Schemata in
`src/vertrag/`) wird im Testlauf an jeder Antwort geprüft; der Abgleich
mit der Android-App liest deren Retrofit-Schnittstelle (`app-endpunkte`).

Regeln für neue Tests stehen in `CLAUDE.md` im Wurzelordner: Ein Test prüft
Verhalten, nicht Quelltext; er nennt im Kopf seine Gegenprobe (was kaputt
gemacht wurde und welcher Teil dann rot war); leere Listen prüfen nichts.
