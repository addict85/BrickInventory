# Begründungen zu `test/set-delete-and-quantity-db.test.js`

Die ausführlichen Kommentare aus `test/set-delete-and-quantity-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Set löschen: EINE Rückfrage, und alles Zugehörige geht mit.
Setanzahl ändern: Teile und Minifiguren ziehen mit.

── Marcos Befund ───────────────────────────────────────────────────────────
„Wenn ich in der Android-App ein Set lösche, erscheint eine Rückfrage und das
Set wird gelöscht. Wenn ich in der Webapp ein Set lösche, erscheinen 2
Rückfragen. In beiden Fällen soll nur eine Rückfrage erscheinen und das Set
direkt gelöscht werden inkl. Teile und Minifiguren die zu diesem Set
gehören. Kannst du bitte auch prüfen, dass die Anzahl korrekt angepasst wird
bei den Minifiguren und den Teilen, wenn die Setanzahl erhöht oder reduziert
wird?"

── Teil 1: die Rückfrage ───────────────────────────────────────────────────
Der Löschknopf im Detail-Dialog der Webapp fragte selbst nach und rief danach
delSet(), das ein zweites Mal fragte. Von der Kachel und aus der Listenzeile
kam nur eine — dieselbe Handlung, drei Einstiege, zwei Erlebnisse.

── Teil 2: die Mengen ──────────────────────────────────────────────────────
Hier war NICHTS zu reparieren, und genau deshalb steht der Test hier: Die
Teile eines Sets liegen mit ihrer Menge JE EXEMPLAR in der Tabelle, und die
Abfragen multiplizieren mit sets.quantity. Nachgemessen mit einem Set aus 10
Teilen und 1 Minifigur:

    Menge 1 → Teile 10, Minifiguren 1
    Menge 3 → Teile 30, Minifiguren 3
    zurück  → Teile 10, Minifiguren 1

Der Test hält das fest, weil die Multiplikation an mehreren Stellen steht
(Kennzahlen, Teileliste, Minifigurenliste, Minifiguren-Kennzahlen) und in
dieser Reihe schon mehrfach eine davon vergessen wurde. Dazu die
Zusammenfassungstabelle (src/teile/partsSummary.ts), die vorberechnete Mengen
hält: Ihre Zähler-Trigger hängen an `parts` UND `sets` — fiele `sets` weg,
bliebe die Teilezahl nach einer Mengenänderung stehen, ohne dass irgendetwas
falsch aussähe.
```

<a id="stellen"></a>
## `const stellen = (h.match(/mengeAus\('sm', ?1\)/g) || []).length;`

```text
Teile und Minifiguren eines Sets zählen JE EXEMPLAR mal Setanzahl.

Gesucht wird jetzt der Aufruf des Helfers statt der ausgeschriebenen
Formel: Hier stand `COALESCE(s.quantity, ?1)`, und die Spalte ist mit
Migration 0036 weg. Die „1" ist dieselbe geblieben — sie heisst „Set
nicht im Bestand, Teil trotzdem zaehlen" und ist der zweite Parameter
von mengeAus() (db/bestandsmenge.ts).
```

<a id="roh-stelle"></a>
## `const roh = await db.get(`

```text
Die Stückzahl je Exemplar bleibt bei 10 — multipliziert wird beim
Lesen, nicht beim Schreiben. Seit Migration 0038 steht sie nicht mehr
in `parts` (die Spalte gibt es nicht), sondern EINMAL im Katalog des
Sets. Stünde dort 30, hätte jemand die Setmenge hineingerechnet, und
das nächste Ändern rechnete auf einem schon multiplizierten Wert
weiter — zusätzlich wäre die Zahl dann für JEDES Konto falsch, das
dasselbe Set hält, denn der Katalog ist gemeinsam.
```
