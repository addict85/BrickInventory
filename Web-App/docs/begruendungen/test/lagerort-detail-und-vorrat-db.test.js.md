# Begründungen zu `test/lagerort-detail-und-vorrat-db.test.js`

Die ausführlichen Kommentare aus `test/lagerort-detail-und-vorrat-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Lagerort muss im DETAIL stehen — und nur in den Konten, die ihn haben.

── Marcos zwei Befunde ─────────────────────────────────────────────────────

  „Die Lagerorte scheinen nicht korrekt zu funktionieren. Wenn ich einen
   setze und das Set später aufrufe ist er weg. Wenn ich in den Filtern nach
   einem Account filtere, erscheinen die falschen Lagerorte im Filter und in
   den Sets ist keiner gesetzt."

Zwei getrennte Fehler, beide aus der Umstellung auf eine ID (Migration 0031).
NACHGEMESSEN, Hauptkonto mit einem Unterkonto, Set beim Hauptkonto, Ort
„Estrich" darauf gesetzt:

    sets.storage_id in der Datenbank : 1
    Antwort der LISTE   → storage    : "Estrich"
    Antwort des DETAILS → storage    : undefined   ← Befund 1
    Vorrat Hauptkonto                : ['Estrich']
    Vorrat Unterkonto                : ['Estrich']  ← Befund 2
    Sets des Unterkontos MIT Lagerort: 0

  Befund 1  Bis 0031 trug die sets-Zeile den NAMEN in einer Spalte `storage`,
            und `SELECT s.*` im Detail lieferte ihn mit. Seither trägt sie
            `storage_id`. Die LISTE löst die ID auf, das DETAIL nicht.
  Befund 2  setzeLagerort() legte den Ort in JEDEM Konto an, in das der
            Aufrufer schreiben darf (`FROM users WHERE id = ANY($1)`) — nicht
            nur in denen, deren Zeilen er beschreibt. Die leeren Einträge
            stehen danach im Kontofilter.

── Warum als Verhaltenstest mit der ALTEN Form daneben ─────────────────────

Beide Gegenproben stehen unten im Test selbst: Er führt die frühere Fassung
der Abfrage beziehungsweise des INSERT noch einmal aus und zeigt, dass sie
genau das Bild von oben erzeugt. Damit hängt die Gegenprobe nicht daran, dass
jemand später denselben Quelltext nochmals von Hand verschlechtert — sie
läuft bei jedem Testlauf mit.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
```

<a id="stelle"></a>
## `await haeltSet(db, KIND, SN, 1);`

```text
Die Kehrseite von Befund 2: Nicht „nur das Hauptkonto", sondern „wer die
Zeile hält". Hält das Unterkonto ein Exemplar, gehört der Ort auch dorthin
— und zwar als EIGENE Zeile, weil ein Regal in einer Wohnung steht
(Migration 0020).
Wie im Aufbau oben: Name im Katalog (schon da), Stueckzahl in der
Erfassung.
```

<a id="der-lagerortfilter-der-listen-wirkt-uebe"></a>
## `test('der Lagerortfilter der Listen wirkt über die Route', async (t) =`

```text
Befund 3: der Lagerortfilter der Set-Liste — über die ROUTE geprüft.

── Marcos Befund ───────────────────────────────────────────────────────────

  „Der Filter mit dem Lagerort funktioniert nicht. Es werden immer alle
   Sets angezeigt."

NACHGEMESSEN im Quelltext: Der Filter in getSets() ist richtig, und das
Frontend schickt ihn auch (`addLagerParam` in public/js/14-scope.js setzt
`storage=`). Dazwischen liegt die Route, und die zerlegte die Anfrage:

    const { search, theme, sort, page, page_size } = req.query;
    const r = await getSets(…, { search, theme, sort, page, page_size });

`storage` ist in dieser Liste nicht enthalten — es wurde stillschweigend
weggelassen, und `query.storage` in getSets war immer undefined. Der Filter
hat damit NIE funktioniert: Die Route (Commit 86f7228) zerlegte die Anfrage
schon, als der Filter dazukam (93ff992, „Lagerort: wo liegt das
eigentlich?"), und jener Commit hat sie nicht mitgezogen.

── Warum dieser Test über die Route geht und nicht über getSets() ──────────

Weil getSets() nie kaputt war. Ein Test, der den Helfer direkt mit
`{ storage: 'Estrich' }` ruft, wäre von Anfang an GRÜN gewesen und hätte
Marcos Fehler nie gesehen — die Teile-Route reicht `req.query` als Ganzes
weiter, die Set-Route nicht, und genau dieser Unterschied ist der Fehler.
Geprüft werden muss also der Weg, den die Oberfläche nimmt.

Dasselbe gilt für die Teileliste: Sie bekommt denselben Filter mit, und
deshalb steht sie hier gleich daneben.
```
