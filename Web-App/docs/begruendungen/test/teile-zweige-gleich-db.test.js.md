# Begründungen zu `test/teile-zweige-gleich-db.test.js`

Die ausführlichen Kommentare aus `test/teile-zweige-gleich-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Teileliste hat ZWEI Wege — sie müssen dieselben Typen liefern.

── Was im Betrieb passiert ist ─────────────────────────────────────────────

Marcos Android-App zeigte „Keine Teile", dazu die Meldung:

    Expected valid boolean literal prefix, but had '0'
    at path: $.parts[0].is_spare      →    "is_spare":0

Das Kotlin-Modell führt `is_spare` als Boolean. Ein einziger Zahlenwert
lässt die Verarbeitung der GANZEN Seite scheitern — deshalb blieb die Liste
leer statt lückenhaft.

── Warum es auf keiner Testinstallation zu sehen war ───────────────────────

getParts() bedient sich aus zwei Quellen:

  Live-Abfrage      → `is_spare: istErsatzteil(p.is_spare)`  → true/false
  Zusammenfassung   → Spalte roh aus parts_summary (INTEGER) → 0/1

Welcher Weg antwortet, hängt allein davon ab, ob die Zusammenfassung frisch
ist. Ein NEUES Konto bekommt die Live-Abfrage und korrektes JSON; ein
gewachsenes bekommt die Zusammenfassung. Der Fehler entsteht also erst,
wenn der Hintergrundaufbau einmal durchgelaufen ist — und genau deshalb war
er weder lokal noch in der CI zu sehen, wo Konten immer frisch sind.

── Was hier geprüft wird ───────────────────────────────────────────────────

Nicht nur `is_spare`. Geprüft wird die REGEL: Für dieselben Daten müssen
beide Wege für JEDES Feld denselben JSON-Typ liefern. Die Regel stand schon
im Baum, angewandt auf ein einzelnes Feld — der Kommentar an getParts sagt
„Der JSON-Typ von total_quantity darf nicht vom Zweig abhängen". Er gilt für
jedes Feld; für eines war es vergessen worden.

Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
Ausführen: REQUIRE_DB=1 npm test
```

<a id="stelle"></a>
## `await db.run('INSERT INTO set_teile (set_number,part_number,color_id,q`

```text
Ein Ersatzteil UND ein gewöhnliches: Wäre nur eines dabei, könnte ein
Zweig zufällig richtig liegen, ohne die Umwandlung zu machen.
Das Ersatzteilkennzeichen steht seit Migration 0034 in
set_parts_catalog — es gehoert zur TEILELISTE eines Sets, nicht zum
Teil. Die Frage dieses Tests bleibt dieselbe: Beide Wege muessen
denselben TYP liefern.
3002 ist das Ersatzteil, 3001 das gewoehnliche — dieselbe Belegung wie
vorher, als is_spare noch an der Bestandszeile stand.
```
