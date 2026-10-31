# Begründungen zu `src/finanzen/portfolioHistory.ts`

Die ausführlichen Kommentare aus `src/finanzen/portfolioHistory.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="getportfoliohistory-monatsaufloesung"></a>
## `monatsAufloesung`

```text
Auflösung der Rekonstruktion (nicht des Schnappschuss-Wegs): Für Woche und
Monat je Tag, für Jahr und Max je MONAT.

Das ist keine Sparmassnahme an der Anzeige — die Verdichtung auf Monate
passierte ohnehin, nur eben erst NACH dem Laden aller Tageswerte. Jetzt
gruppiert Postgres gleich richtig: Bei 800 Sets und einem Jahr Historie
fällt der Fensterlauf von 292 000 auf 9 600 Zeilen.

Gemessen (800 Sets, 292 000 Zeilen, Haushalt mit zwei Konten, Zeitraum
Max): vorher 1 741 ms und 34 MB Heap, jetzt 931 ms und praktisch kein
zusätzlicher Heap (802 ms Hauptabfrage, 129 ms Startpunkt-Korrektur). Der
Gewinn liegt vor allem im Speicher: Die Zeilen bleiben in der Datenbank.

── Ausnahme: kurze Historie ─────────────────────────────────────────────
Passt der ganze Verlauf in EINEN Monat, ergibt die Monatsauflösung genau
einen Punkt. Daraus lässt sich keine Veränderung ablesen — „Jahr" und
„Max" zeigten dann 0 %, während „Woche" dieselben Daten mit +102 %
auswies. Dieselbe Sammlung, vier Knöpfe, zwei Antworten. In dem Fall wird
unten auf Tagesauflösung zurückgeschaltet; teuer ist das gerade dort
nicht, wo es nur wenige Tage gibt.
```

<a id="kurve"></a>
## `kurve`

```text
── Die Kurve zeigt DEN HEUTIGEN BESTAND über die Zeit ───────────────────

── Marcos Befund ────────────────────────────────────────────────────────
„Neu hinzugefügte Sets sollen nicht dazu führen, dass sich der %-Wert
ändert. Die +850.2% sind offensichtlich nicht korrekt."

Er hat recht, und der Fehler steckte in der Bedeutung der Kurve. Sie zeigte
„Wert dessen, was zu diesem Zeitpunkt erfasst WAR". Wer an einem Tag
vierundzwanzig Sets einträgt, sieht dort einen Sprung — und die Prozentzahl
daneben, die den ersten Punkt mit dem letzten vergleicht, meldet den
Zuwachs der SAMMLUNG als Wertentwicklung. Nachgestellt (2 Sets seit einer
Woche, 24 gestern dazu, Preise leicht FALLEND): +264 %.

Jetzt zeigt sie „was der heutige Bestand über die Zeit wert gewesen wäre".
Ein Set, dessen Preisverlauf erst später beginnt, wird mit seinem ERSTEN
bekannten Preis zurückgeschrieben — es steht damit von Anfang an im Korb
und trägt zur Veränderung genau nichts bei, bis sich sein Preis wirklich
bewegt. Das ist die einzige Lesart, in der die Prozentzahl etwas über
Wertentwicklung aussagt statt über Kaufverhalten.

── Warum die Schnappschüsse dafür nicht taugen ──────────────────────────
Der Preis-Job legte je Konto und Tag einen Gesamtwert unter dem Pseudo-Set
unter einem Pseudo-Set ab, und für ein einzelnes Konto las die Kurve daraus.
Ein solcher Schnappschuss hält fest, was AN JENEM TAG erfasst war — die
Frage „was wäre der heutige Bestand damals wert gewesen" lässt sich daraus
grundsätzlich nicht beantworten. Es war ausserdem eine ZWEITE Fassung
derselben Kurve: Ein einzelnes Konto bekam eine anders gerechnete Linie als
ein Haushalt, und beim Wechsel des Kontofilters sprang die Form.

Der Weg darunter rekonstruiert je Set aus dem Preisverlauf. Der ist nicht
kontogebunden, sondern global — die Kurve entsteht damit RÜCKWIRKEND und
stimmt auch für die Zeit vor einer Haushaltsverknüpfung.
```
