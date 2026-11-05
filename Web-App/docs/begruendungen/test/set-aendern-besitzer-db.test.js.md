# Begründungen zu `test/set-aendern-besitzer-db.test.js`

Die ausführlichen Kommentare aus `test/set-aendern-besitzer-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Kaufpreis und Zustand landen im selben Konto.

── Der Fehler, den das verhindert ──────────────────────────────────────────
updateSet() macht fuer beide dieselbe Bewegung: die Erfassung aendern, die
der Detail-Dialog bearbeitet (die neueste). Es waren zwei Abschriften — und
die zweite hatte ein anderes Konto eingesetzt: der Preis-Zweig `ownerId`,
der Zustands-Zweig `uid`.

Bis Migration 0032 schrieb jede der beiden Bewegungen ZWEIMAL: in die
sets-Zeile und in die Erfassung. Der Spiegel ist weg; die Frage, WELCHE
Zeile getroffen wird, ist dieselbe geblieben — und sie ist der Gegenstand
dieser Datei.

NACHGEMESSEN, bevor etwas geaendert wurde. Set UND Erfassung gehoeren dem
UNTERKONTO, geaendert wird vom Hauptkonto:

    vorher                       sets: N/10   erfassung: N/10
    nach Preis 99 (Hauptkonto)   sets: N/99   erfassung: N/99
    nach Zustand U (Hauptkonto)  sets: N/99   erfassung: N/99   <- unveraendert

(Die sets-Spalte in dieser Messung gibt es seit Migration 0032 nicht mehr.
Die Messung bleibt stehen, weil sie den Fehler beschreibt, der zu dieser
Datei gefuehrt hat.)

Der Preis kam an, der Zustand verschwand STILL: `WHERE user_id =
<Aufrufer>` trifft keine Zeile. Kein Fehler, kein Hinweis — updateSet
meldete Erfolg.

Das bleibt nicht bei der Plakette: effectiveCondition() (src/finanzen/financeCalc)
entscheidet, zu welchem Zustand der Marktpreis geholt wird. Ein Set, das
der Haushalt als gebraucht fuehrt, wurde weiter als neu bewertet.

Die Regel stand schon da — in updateSet ueber der Stelle („ab hier zaehlt
der BESITZER der Zeile") und im Kopf von acquisition-scope-db.test.js. Sie
war nur an einem von zwei Zweigen angewandt. Deshalb steht sie jetzt in
EINER Funktion.

── Warum das ein Verhaltenstest ist ────────────────────────────────────────
Die Aussage ist „beide Aenderungen kommen an demselben Ort an". Am
Quelltext waere nur zu sehen, dass beide dieselbe Funktion rufen — und
nicht, ob dabei die richtige Zeile getroffen wird.

Der Mengen-Zweig weicht BEWUSST ab (Marcos Vorgabe: „Die Anzahl soll immer
von allen angezeigt werden. Wenn ich diese erhoehe, soll es fuer meinen
Account einen neuen Kaufpreis-Eintrag erstellen"). Der letzte Teilschritt
haelt das ausdruecklich fest, damit es niemand „mit vereinheitlicht".
```
