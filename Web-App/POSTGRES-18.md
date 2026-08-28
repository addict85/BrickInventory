# PostgreSQL 16 → 18

**Lies das ganz durch, bevor du anfängst.** Der Weg ist unspektakulär, aber ein
blosser Tausch des Image-Tags zerstört nichts und funktioniert auch nicht — der
Container startet mit einer Fehlermeldung und rührt die alten Daten nicht an.

## Warum es nicht einfach geht

Zwei Dinge gleichzeitig:

1. **Das Datenformat einer Hauptversion ist nie direkt lesbar.** Das gilt für
   jeden PostgreSQL-Sprung, auch 16 → 17.
2. **Ab Version 18 hat das offizielle Docker-Image seinen Ablageort geändert.**
   Die Daten liegen jetzt in einem versionsspezifischen Unterverzeichnis
   (`/var/lib/postgresql/18/docker`), und gemountet wird das Elternverzeichnis
   `/var/lib/postgresql` statt wie bisher `/var/lib/postgresql/data`.
   Das ist der Grund, warum in `compose.yaml` jetzt `./pgdata18:/var/lib/postgresql`
   steht. Der Umbau macht künftige Sprünge (18 → 19 → 20) mit `pg_upgrade`
   deutlich einfacher — dieser eine hier ist der Preis dafür.

Findet das 18er-Image alte Daten am alten Ort, verweigert es bewusst den Start,
statt irgendetwas zu überschreiben.

## Dein altes Verzeichnis bleibt unangetastet

`./pgdata` (Version 16) wird nicht angefasst. Die neue Instanz schreibt nach
`./pgdata18`. Wenn etwas schiefgeht, ist der Rückfall: alte `compose.yaml`
zurückholen, `docker compose up -d` — und du bist wieder auf 16.

Lösche `./pgdata` erst, wenn die neue Instanz ein paar Tage sauber läuft.

---

## Ablauf

### 1. Sicherung ziehen (mit dem NOCH LAUFENDEN 16er-Container)

Das ist der wichtigste Schritt. `pg_dumpall` nimmt Datenbanken, Rollen und
Passwörter mit — `pg_dump` allein täte das nicht.

```bash
cd /pfad/zu/brickinventory

# Prüfen, dass die alte Instanz läuft
docker compose ps postgres

# Vollständiger Abzug
docker compose exec -T postgres \
  pg_dumpall -U brickinventory > pg16-dump.sql

# Plausibilität: sollte deutlich mehr als ein paar KB sein
ls -lh pg16-dump.sql
tail -5 pg16-dump.sql        # muss auf "PostgreSQL database cluster dump complete" enden
```

Endet die Datei nicht mit dieser Zeile, ist der Abzug unvollständig — **nicht
weitermachen**, sondern der Ursache nachgehen (meist zu wenig Plattenplatz).

### 2. Alles anhalten

```bash
docker compose down
```

### 3. Neue Fassung einspielen

Entpacke das neue ZIP über dein Verzeichnis (oder ziehe den Commit). Die
`compose.yaml` darin steht bereits auf `postgres:18-alpine` mit dem neuen
Mount-Pfad.

Falls du deine `compose.yaml` selbst pflegst, sind es genau zwei Zeilen:

```yaml
    image: postgres:18-alpine          # war: postgres:16-alpine
    volumes:
      - ./pgdata18:/var/lib/postgresql  # war: ./pgdata:/var/lib/postgresql/data
```

### 4. Nur die Datenbank hochfahren

Die App bleibt zunächst aus — sie würde sonst gegen eine leere Datenbank ihr
Schema anlegen und dir beim Einspielen in die Quere kommen.

```bash
docker compose up -d postgres

# Warten, bis sie bereit ist
docker compose logs -f postgres      # abbrechen bei "database system is ready to accept connections"
```

### 5. Abzug einspielen

```bash
cat pg16-dump.sql | docker compose exec -T postgres psql -U brickinventory -d postgres
```

Ein paar Meldungen wie `role "brickinventory" already exists` sind normal — die
Rolle hat das Image beim Initialisieren schon angelegt. Echte Fehler erkennst du
an `ERROR:` in Verbindung mit `relation` oder `syntax`.

Gegenprobe:

```bash
docker compose exec -T postgres psql -U brickinventory -d brickinventory \
  -c "SELECT count(*) FROM sets;  SELECT count(*) FROM parts;  SELECT version();"
```

Die Zahlen müssen zu dem passen, was du vorher in der App gesehen hast. Wenn
nicht: Schritt 2–5 wiederholen, nichts ist verloren — `./pgdata` liegt noch da.

### 6. App starten

```bash
docker compose up -d
docker compose logs -f app
```

Im Log solltest du sehen:

```
✅ Schema aktuell (…)  —  oder die einmalige Migration
✅ Trigramm-Indizes für die Katalogsuche vorhanden
[img-migrate] Bilder nach data/images/ verschoben: …
```

### 7. Aufräumen — frühestens nach ein paar Tagen

```bash
rm -rf ./pgdata          # die alte 16er-Ablage
rm pg16-dump.sql         # oder ins Backup-Verzeichnis verschieben
```

---

## Was du hinterher prüfen solltest

- **Anmelden** und ein paar Sets in der Galerie ansehen (Bilder laden?)
- **Katalogsuche** mit einem Suchbegriff — sie ist jetzt trigramm-indiziert und
  sollte spürbar schneller sein als vorher
- **Android-App** einmal synchronisieren
- **Finanzen** aufrufen — dort fällt ein unvollständiger Abzug am ehesten auf

## Wenn etwas hängt

| Symptom | Ursache |
|---|---|
| `these Docker images are configured to store database data in a format which is compatible with "pg_ctlcluster"` | Der Mount zeigt noch auf `/var/lib/postgresql/data`. Pfad in `compose.yaml` korrigieren. |
| App meldet `relation "sets" does not exist` | Der Abzug wurde nicht eingespielt oder ging in die falsche Datenbank. Schritt 5 wiederholen. |
| `pg_dumpall`-Datei ist winzig | Der alte Container lief nicht. `docker compose up -d postgres` mit der ALTEN compose.yaml, dann erneut. |
| Katalogsuche meldet im Log `pg_trgm nicht verfügbar` | Rechte fehlen. Die App läuft trotzdem, nur ohne den Suchindex. |

## Hinweis zu künftigen Sprüngen

Ab jetzt ist der Weg leichter: Weil das Elternverzeichnis gemountet ist, kann
`pg_upgrade --link` bei 18 → 19 die Dateien hart verlinken statt sie zu kopieren.
Ein Dump-und-Restore wie hier ist dann nicht mehr nötig.
