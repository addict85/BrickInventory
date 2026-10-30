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
cp .env.example .env    # SESSION_SECRET, DB_PASSWORD und BRICK_HOST eintragen
docker compose up -d --build
# → https://<BRICK_HOST>   (Port 80 leitet auf HTTPS um)
```

Pflicht in `.env`: `SESSION_SECRET`, `DB_PASSWORD` und `BRICK_HOST` — der
Name oder die IP-Adresse, unter der Geräte den Server erreichen.

### HTTPS mit eigener CA (Caddy)

Vor der App steht Caddy (`compose.yaml`, `Caddyfile`). Er macht TLS mit einer
eigenen, lokalen CA (`tls internal`) für `BRICK_HOST` und leitet an die App
weiter; die App selbst veröffentlicht keinen Port mehr. Die CA liegt unter
`./caddy/data/` — mitsichern.

Damit Browser und Telefone dem Zertifikat vertrauen, kommt das
**Wurzelzertifikat** einmal auf jedes Gerät: Es liegt unter
`https://<BRICK_HOST>/ca.crt` (auch über `http://`, ohne Umleitung). Der
Fingerabdruck steht in den Einstellungen unter „Sicherheit“ zum Abgleich; die
Android-App braucht das nicht, sie bekommt ihn über den QR-Code. Schritt für
Schritt: `UPGRADE.md`, Abschnitt 14.

### Ohne HTTPS (bewusste Ausnahme)

Wer ohne TLS betreiben will (etwa zum Ausprobieren auf `localhost`), nimmt in
`compose.yaml` beim Dienst `app` die Zeilen `ports:` ein und setzt in `.env`
`COOKIE_SECURE=0` und `APP_BASE_URL=http://…`. Passwort, Sitzung und App-Token
gehen dann lesbar durchs Netz; „Unbegrenzt“ beim QR-Code und Passkeys gibt es
dann nicht.

### Pfade anpassen

```yaml
volumes:
  - /mnt/data:/app/data   # eigener Datenpfad — enthält auch alle Bilder
```

Bilder brauchen **kein eigenes Volume**: Sie liegen unter `data/images/`
(Sets in `data/images/sets/`, Teile in `data/part_images/`), Vorschaubilder
jeweils als `<name>_thumb.jpg` daneben. Ein Backup von `data/` erfasst damit
alles.

### Datenbankpasswort ändern
Für eine **neue** Installation vor dem ersten Start eine Datei `.env` neben
`compose.yaml` anlegen:
```
DB_PASSWORD=mein-sicheres-passwort
```
`compose.yaml` gibt es an die Datenbank, die App und pgweb weiter; ohne
`DB_PASSWORD` bricht `docker compose up` ab. Eine **bestehende** Datenbank
behält ihr Passwort aus dem ersten Start; dort den bisherigen Wert eintragen.

Läuft die Datenbank noch mit dem alten Beispielpasswort `brickinventory_secret`,
verweigert der Server in Produktion den Start. Ändern: `docker compose exec
postgres psql -U brickinventory -c "ALTER USER brickinventory PASSWORD
'neues-passwort'"`, dann `DB_PASSWORD` in `.env` setzen und `docker compose up
-d` ausführen.

### DB-Pool-Größe anpassen
Normalerweise **nicht nötig**: Die App rechnet `min(15, 80 / Anzahl Worker)`
selbst aus; `WEB_WORKERS: 0` heisst „ein Worker je Kern, mindestens zwei",
und mit derselben Zahl rechnet der Pool. Nur wenn die PostgreSQL-Instanz ein abweichendes `max_connections`
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
Gutschein-PINs und die Geheimnisse des zweiten Faktors liegen verschlüsselt im
Dump; der Schlüssel dazu steht in `data/.datenschluessel` (oder in `DATA_KEY`).
**Diese Datei mitsichern, aber getrennt vom Dump** — ohne sie lassen sich die
Werte nach einer Wiederherstellung nicht mehr lesen und müssen neu eingegeben
werden; Konten mit zweitem Faktor kommen dann nicht mehr herein. `backup.sh`
lässt sie deshalb aus dem `data/`-Archiv weg und legt sie nur mit
`BACKUP_SCHLUESSEL_ZIEL=/anderer/ort` dort ab (etwa ein USB-Stick oder ein
anderes Laufwerk als das der Sicherungen); ohne die Angabe meldet es bei jedem
Lauf, dass der Schlüssel fehlt. `restore.sh` fragt nach, bevor es ohne
`data/.datenschluessel` neu startet. Die Passwort-Hashes stehen trotzdem im Dump. `backup.sh` legt die Dateien deshalb nur für den
Besitzer lesbar an (`umask 077`) und warnt, wenn das Zielverzeichnis für
andere offen ist. Wer `backups/` auf ein NAS oder in eine Cloud kopiert,
verschlüsselt es vorher (z. B. `gpg -c` oder `age`).

### Automatische Kopie vor einem Update

Bringt ein Update neue Migrationen mit, kopiert der Server vorher alle
Tabellen mit Nutzerdaten (`users`, jede Tabelle mit `user_id` und jede mit Fremdschlüssel auf `users`, etwa die Haushaltsverknüpfungen) in ein
eigenes Schema `vor_migration_<Datum Uhrzeit>` derselben Datenbank. Die drei
jüngsten bleiben. Das ersetzt `backup.sh` nicht — Katalog und Bilder fehlen
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
| `APP_BASE_URL` | Die Adresse, unter der der Server von **aussen** erreichbar ist (z. B. `https://lego.example.org`). Sie steckt in den Links der E-Mails und im **QR-Code zur Verknüpfung der App**. Ohne sie übernehmen die Bestätigungs-Links den Host aus dem Request-Header, und **Passwort-vergessen-Mails werden im Betrieb gar nicht versendet** (ein gefälschter Host-Header bekäme sonst den Reset-Link); der QR-Code wird **gar nicht erst erzeugt** — er trüge sonst die Adresse aus der Browserzeile, und die App fände den Server ausserhalb des Heimnetzes nie wieder. |
| `TRUST_PROXY` | Wem der Server `X-Forwarded-For`/`-Proto` glaubt — nur **ausdrücklich genannten** Adressen. `compose.yaml` setzt die feste Adresse von Caddy (`172.28.73.10`). Ohne Angabe (ausserhalb von Compose) **nur Loopback** (`127.0.0.0/8`, `::1`). Steht ein Proxy davor, seine **feste** Adresse eintragen: im Compose-Netz `brickinventory-net` (`172.28.73.0/24`) z. B. `172.28.73.10` per `ipv4_address`, auf einem anderen Rechner z. B. `192.168.1.5`. Mehrere durch Komma; Netze nur klein (IPv4 ab `/16`, IPv6 ab `/64`). `false` schaltet es ganz ab. `docker`, `true` und Hop-Zahlen verweigern den Start: Damit könnte jeder Container oder Client im Netz seine Absenderadresse selbst angeben und die Anmeldesperre umgehen. |
| `UPLOAD_KONTINGENT_MB` | Wie viel Platz eigene Anleitungen (PDF/JPG/PNG) je Konto belegen dürfen, in MB (Vorgabe `2048`). Der Inhalt jeder Datei wird geprüft; eine Datei, deren Inhalt nicht zum Typ passt, wird abgewiesen. |
| `DATA_KEY` | Schlüssel (32 Byte, Base64) für die verschlüsselten Geheimnisse in der Datenbank. Ohne Angabe erzeugt der Server beim ersten Start `data/.datenschluessel` (nur für den Besitzer lesbar). Wer den Schlüssel lieber getrennt von `data/` hält, setzt ihn hier: `openssl rand -base64 32`. |
| `ADMIN_PASSWORD` | Passwort des beim ersten Start angelegten Admins. Sonst wird ein Zufallspasswort erzeugt und **einmalig** ins Log geschrieben. |
| `SESSION_SECRET` | Pflicht in Produktion (der Start bricht sonst ab). |
| `MAIL_KONSOLE_MIT_TOKEN` | Ohne SMTP schreibt der Server jede Mail ins Log, den Link darin **ohne Token** — das Log sieht jeder Verwalter, und ein Rücksetz-Link ist ein Zugang zum Konto. `1` zeigt den vollständigen Link, etwa auf einem Entwicklungsrechner ohne Mailserver. Nur dort setzen. |
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
