# Begründungen zu `test/wanted-liste-db.test.js`

Die ausführlichen Kommentare aus `test/wanted-liste-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
BrickLink-Wanted-Listen lesen und auf Rebrickable-Nummern abbilden.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

  „Ich möchte auch Bricklink-Wanted-Listen importieren können … Bitte
   beachte dass im xml BL-IDs und nicht Rebrickable-IDs enthalten sind."

── Was an Marcos echter Datei GEMESSEN wurde ───────────────────────────────

Seine Datei (castle.xml, 2019 Zeilen) liegt NICHT im Baum — sie ist seine,
und ein Beispiel gehört nicht ins Repository, nur weil es gerade zur Hand
ist. Der Leser ist aber gegen sie gelaufen, und das sind die Zahlen:

    224 Posten, alle ITEMTYPE=P
    886 Stück in der Summe, 139 Posten mit Menge > 1
    24 verschiedene BL-Farben
    0 fremde Arten, 0 ohne Nummer
    0 mit Höchstpreis (alle MAXPRICE=-1.0000)
    alle CONDITION=X → Zustand null („egal")

Die Vorlagen unten sind daran gebaut: dieselben Felder, dieselbe
Reihenfolge, dieselben Schreibweisen der Teilenummern (rein numerisch,
Ziffern+Buchstaben, bedruckt mit pb, x-Präfix).
```

<a id="der-import-erfindet-keine-farbe-und-schr"></a>
## `test('der Import erfindet keine Farbe und schreibt ihren Namen', { con`

```text
── Nachtrag 19.10.: was der SCHREIBWEG mit `farbeOffen` tut ────────────────

Marcos Befund, mit Bildschirmfoto aus der App: „Die Farbe wurde nicht immer
übernommen und die Teile sind nun mehrfach vorhanden (bsp 3001). Das sollte
nicht sein."

Die Auflösung oben tat ihre Arbeit — sie setzte `farbeOffen` und sagt im
Fall darüber sogar, warum: „den Posten ohne Hinweis anzulegen hiesse, eine
falsche Farbe zu behaupten". Der Schreibweg las das Feld NIE. Er schrieb
`color_id: a.rbFarbe ?? 0` — und 0 ist bei Rebrickable SCHWARZ, nicht
„keine Farbe" (die Warnung steht wörtlich in routes/parts.ts).

NACHGESTELLT am laufenden Server, vorher:

    part_number | color_id | color_name
    3001        |        4 | (leer)      ← BL-Farbe 5, richtig abgebildet
    3001        |        0 | (leer)      ← BL-Farbe 85, ERFUNDEN

Zwei Karten für ein Teil, beide ohne Farbnamen. Nachher: eine Zeile,
color_id 4, color_name „Red" — und der zweite Posten offen, mit Grund.

Hier wird mit einem gefälschten Anleger geprüft und nicht über die Route:
Die Schnittstelle `Anleger` gibt es genau dafür („ein Test könnte Zähler
hineinstecken").
```

<a id="z-stelle"></a>
## `const z = zaehler();`

```text
── Marcos Entscheidung vom 21.10. ──────────────────────────────────────

  „Kannst du bei der Bricklink-Wanted-Listen xml-Import das Attribut:
   <MAXPRICE>0.8578</MAXPRICE> auf den Kaufpreis mappen."

Hier galt das Gegenteil, begründet damit, MAXPRICE sei eine Suchgrenze
und kein bezahlter Preis. Das war eine Annahme über Marcos Arbeitsweise
— er trägt dort den bezahlten Preis ein.

Die zweite Hälfte bleibt, wie sie war: `-1.0000` ist KEIN Preis (Fall 3
oben prüft das am Leser), und ohne Preis holt weiterhin der Marktpreis
den Wert. Beides zusammen ist der Fall hier — eine Prüfung nur auf den
Preis wäre auch grün, wenn jede -1 als Betrag durchginge.
```

<a id="ein-abbruch-haelt-nach-spaetestens-zehn"></a>
## `await t.test('ein Abbruch hält nach spätestens zehn Posten an', async `

```text
── Abbrechen (Marcos Wunsch vom 20.10., indirekt) ───────────────────────

Der Fortschritt steht seit dem 20.10. auch im Auftragsdatensatz, den beide
Oberflächen als Balken zeigen — und dieser Balken trägt ein Kreuz. Ein
Import, der das Kreuz nicht beachtet, hätte einen Abbrechen-Knopf, der
lügt.

Geprüft wird der TAKT: alle zehn Posten wird gefragt, nicht bei jedem
(die Frage ist eine Datenbankabfrage) und nicht nie.
```
