# Begründungen zu `test/verdrahtung-laeuft-db.test.js`

Die ausführlichen Kommentare aus `test/verdrahtung-laeuft-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Fünf Verdrahtungen, die bisher nur als Textmuster zugesichert waren.

── Woher das kommt ─────────────────────────────────────────────────────────

An einem Tag sind zwei Fehler durchgerutscht, und beide hatten dieselbe
Form: Eine Prüfung las den QUELLTEXT und bestand, während die Funktion das
Falsche tat (der Lagerortfilter kam nie an der Route an;
moveManualAcquisition löschte beim Absender alles). Die Regel daraus:

    Eine Behauptung der Form „der Weg A → B lebt" braucht einen Lauf über
    diesen Weg. Ein Muster, das den Aufruf im Quelltext findet, beweist nur,
    dass jemand ihn hingeschrieben hat.

Gemessen wurden 26 solche Zusicherungen über Routen-Quelltext in sechs
Dateien. Davon sind acht durch test/kontowechsel-ueber-die-route-db.test.js
abgedeckt und vier sind KEINE Verdrahtungsbehauptungen (sie sagen „diese
Zeile darf nicht zurückkommen" — das kann kein Lauf prüfen).

Eine betraf eine Sperre (withInventoryLock). Hier stand „für die ein Lauf
wackelig wäre" — das galt für die naheliegende Bauart (zwei Verschiebungen
gleichzeitig losschicken und hoffen, dass eine verliert), nicht für die
Sache: test/sperre-beim-verschieben-db.test.js hält die Sperre von einer
eigenen Verbindung und liest in pg_locks nach, ob ein Warter steht. Das ist
ein Zustand, keine Dauer, und damit kein Wettlauf.

Die fünf hier übrigen laufen jetzt:

  1. media-auth.test.js:123   — der PDF-Download trägt requireToken
  2. umleitungen.test.js:187  — der Bild-Proxy prüft den Host
  3. passwortlaenge.test.js   — die Routen benutzen passwortZuKurz()
  4. manual-acq-refresh:126   — die Tagesprüfung gilt für alle drei Arten
  5. household.test.js:643    — Verschieben ohne acquisition_ids wird abgelehnt

Die Musterregeln bleiben, wo sie stehen: Sie fangen eine gelöschte Zeile,
und das ist etwas anderes als ein Lauf. Ergänzt, nicht ersetzt.

Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
REQUIRE_DB=1.
```

<a id="heute"></a>
## `const heute  = new Date().toISOString().slice(0, 10);`

```text
findSameDayAcquisition() sitzt im ÄNDERN-Weg: Wer das Datum einer
Erfassung auf einen Tag schiebt, an dem für dieselbe Position schon
eine steht, bekommt 409. Ohne die Prüfung liefe es in den eindeutigen
Index (seit 0047 idx_set_acq_tag_merkmale) und käme als 500 zurück.
Kollision heisst seit 0047: gleicher Tag, Zustand, Preis und Währung —
deshalb tragen beide Käufe denselben Preis.

Zugesichert war bisher, dass `kind: 'set'|'part'|'fig'` im Quelltext
der Fabrik steht — nicht, dass die Prüfung für eine davon greift.
```
