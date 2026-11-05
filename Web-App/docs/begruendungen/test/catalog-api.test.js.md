# Begründungen zu `test/catalog-api.test.js`

Die ausführlichen Kommentare aus `test/catalog-api.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Integrationstest für /api/v1/catalog gegen echtes PostgreSQL.
Gestubbt wird NUR requireToken (Auth) — Router, db-Modul und SQL laufen
1:1 wie in Produktion. Prüft u.a. den Zukunftsjahr-Randfall (nur wenige
Sets im Maximaljahr), Von-Bis-Bereiche, Theme-Vererbung und owned-Flags.

Voraussetzung: erreichbare Test-DB (Inhalt wird GELÖSCHT!), z.B.
  createdb cattest && psql -c "CREATE USER tester PASSWORD 'test'"
Verbindung via TEST_DATABASE_URL, Default:
  postgres://tester:test@localhost/cattest
Ohne erreichbare DB wird die Suite übersprungen (skip), nicht rot.

Ausführen: npm run test:api   (baut vorher die .ts -> .js)
```

<a id="schemawiederherstellen"></a>
## `async function schemaWiederherstellen() {`

```text
Stellt das echte Schema wieder her, das seed() durch Attrappen ersetzt.

── Warum das noetig ist ────────────────────────────────────────────────────
seed() legt `sets` als Zweispalter an (user_id, set_number) und
liess sie so stehen. Fuer DIESEN Test reicht das — fuer jeden spaeteren, der
danach in derselben Datenbank laeuft, nicht: Er findet eine verstuemmelte
Tabelle. Aufgefallen ist es erst, als csv-export-acquisitions-db.test.js
`sets.name` brauchte und im GESAMTLAUF rot wurde, einzeln aber gruen blieb —
die unangenehmste Sorte Fehler, weil sie von der Reihenfolge abhaengt.

Seit db/basis.sql legt initSchema() in einer bestehenden Datenbank nichts
mehr nach. Deshalb wird das Schema ganz neu aufgebaut: Basis plus
Migrationen, wie bei einer frischen Installation.
```

<a id="stelle"></a>
## `await db.run('CREATE TABLE sets (user_id INTEGER, set_number TEXT)');`

```text
`sets` bleibt die einzige Attrappe. Die Setmenge steht seit Migration
0036 in set_acquisitions, und die Katalogliste liest sie von dort
(owned_quantity ueber db/bestandsmenge.ts) — mit nur `sets`
antwortete sie 0 (gemessen: „expected 2, actual 0").

Diese Tabelle wird deshalb ECHT benutzt und NICHT nachgebaut: Ihr
eindeutiger Index idx_set_acq_tag_zustand („je Konto, Set und Tag eine
Erfassung") steht nur in Migration 0008. Eine Attrappe haette ihn nicht,
und weil initSchema() ihn auch nicht anlegt, waere er fuer jede spaetere
Datei dieses Laufs weg — die Tagesregel still ausgeschaltet. Genau die
Sorte reihenfolgenabhaengiger Fehler, die der Kopfkommentar von
schemaWiederherstellen() beschreibt.
```

<a id="stelle-2"></a>
## `await db.run('INSERT INTO users (id, username, password_hash)`

```text
Der Bestand: Konto 1 haelt 9000-1, und zwar zwei Exemplare — die Zahl
steht in der Erfassung.

Die echte set_acquisitions traegt einen Fremdschluessel auf users, also
muss das Konto existieren. initSchema() legt beim Erststart einen Admin
an, der diese ID meist schon hat; ON CONFLICT DO NOTHING macht beide
Faelle gleich.
```

<a id="stelle-3"></a>
## `await schemaWiederherstellen();`

```text
── REIHENFOLGE: erst das Schema, dann der Pool ──────────────────────────
Der erste Anlauf stand als `test.after(...)` UNTER dieser Zeile und lief
damit gegen einen bereits geschlossenen Pool. Ein `.catch(() => {})` darin
hat den Fehler still verschluckt — die Wiederherstellung fand nie statt,
und der Gesamtlauf blieb rot, ohne zu sagen warum. Kein stilles catch hier:
Scheitert die Wiederherstellung, sollen es die naechsten Tests nicht
ausbaden.
```
