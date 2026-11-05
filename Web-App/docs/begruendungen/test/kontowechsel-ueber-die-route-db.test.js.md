# Begründungen zu `test/kontowechsel-ueber-die-route-db.test.js`

Die ausführlichen Kommentare aus `test/kontowechsel-ueber-die-route-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Kontowechsel einer Erfassung — über die ROUTE, nicht über ein Muster.

── Warum es diese Datei gibt ───────────────────────────────────────────────

An EINEM Tag sind zwei Fehler durchgerutscht, und beide hatten dieselbe
Form: Eine Prüfung las den QUELLTEXT und bestand, während die Funktion das
Falsche tat.

  1. Der Lagerortfilter der Set-Liste. Die Route zerlegte req.query in eine
     Auswahl ohne `storage`; der Filter kam nie an. Geprüft war, dass
     getSets() den Filter BAUT — nicht, dass die Route ihn WEITERREICHT.
  2. moveManualAcquisition() löschte beim Absender alles, weil es eine
     Spalte las, die Migration 0038 entfernt hat. Geprüft war, dass der
     Endpunkt die Funktion RUFT — nicht, was sie tut.

Die Regel dahinter ist nicht „Quelltextprüfungen sind schlecht". Viele sind
das einzig Mögliche: „hier darf kein `s.*` stehen", „diese entfernte
Anweisung darf nicht zurückkommen", „beide Clients nutzen DIESELBE
Umsetzung". Die Regel ist enger:

    Eine Behauptung der Form „der Weg A → B lebt" braucht einen Lauf über
    diesen Weg. Ein Muster, das den Aufruf im Quelltext findet, beweist nur,
    dass jemand ihn hingeschrieben hat.

── Was hier läuft ─────────────────────────────────────────────────────────

Die drei Arten gehen durch DENSELBEN Dienst (src/sammlung/erfassungen.ts) und
dieselbe Umsetzung (moveManualAcquisition bzw. moveSetBetweenAccounts).
Geprüft werden alle drei über ihre echten Adressen, dazu die beiden
Abweisungen, die bisher nur als Muster zugesichert waren:

  PUT /api/v1/sets/:sn/acquisitions/:id
  PUT /api/v1/parts/:nr/:farbe/acquisitions/:id
  PUT /api/v1/minifigs/:nr/acquisitions/:id

Die Mengenerhaltung beim TEILE-Weg steht in
test/erfassung-verschieben-rest-bleibt-db.test.js — hier geht es um den
Weg selbst und um die Arten daneben.

Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
REQUIRE_DB=1.
```
