# Begründungen zu `src/finanzen/rechnung/zustand.ts`

Die ausführlichen Kommentare aus `src/finanzen/rechnung/zustand.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Der Zustand eines Sets — die eine Regel, nach der Preis UND Gewinnrechnung
entscheiden, ob „neu" oder „gebraucht" gilt.

Eigene Datei, weil sie von beiden Seiten des Finanzteils gebraucht wird:
von der Bewertung (welcher Marktpreis gilt) und von der Gewinnrechnung
(welcher Kaufpreis zaehlt). Stuende sie in einer der beiden, muesste die
andere sie von dort holen — und die Richtung waere willkuerlich.
```

<a id="effectivecondition"></a>
## `effectiveCondition`

```text
Zustand eines Sets nach derselben Regel wie die Anzeige
(utils/handlers.ts → getSetConditionAggregate):
Sobald EINE Erfassung gebraucht ist, gilt das Set als gebraucht; sonst neu.

Vorher richtete sich die Bewertung allein nach sets.condition. Weicht der
gespeicherte Wert von den Erfassungen ab — etwa weil ein Set nachträglich auf
„Neu" korrigiert wurde — zeigte die Kachel „Neu", der Marktpreis stammte aber
aus dem Gebraucht-Eintrag. Genau diese Abweichung war die Ursache für den
wiederholt zu niedrigen Preis.

── Der dritte Zweig ist weg, und zwar genau jetzt ─────────────────────────

Hier stand ein Rueckfall auf den gespeicherten Wert der Stammzeile, mit der
Begruendung: „`parts.condition` und `minifigs.condition` gibt es noch … Der
Zweig fällt mit den beiden Spalten, nicht vorher."

Migration 0032 hat sie den Sets genommen, 0035 den Teilen und Figuren. Fuer
manuelle Positionen traegt 0035 eine Erfassung nach und prueft danach, dass
keine ohne geblieben ist — es gibt also keinen Fall mehr, in dem der
gespeicherte Wert die einzige Auskunft waere. Fuer Teile und Figuren aus
einem Set stand die Spalte seit jeher auf dem Vorgabewert 'N'.

Damit liest diese Funktion nur noch die zwei Zaehler — und kann gar nicht
mehr von der Anzeige abweichen, denn conditionFromAcquisitions() in
src/bestand/gemeinsam.ts rechnet aus denselben zwei Zahlen.
```
