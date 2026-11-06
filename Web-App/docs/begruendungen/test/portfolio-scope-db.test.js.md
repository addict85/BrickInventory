# Begründungen zu `test/portfolio-scope-db.test.js`

Die ausführlichen Kommentare aus `test/portfolio-scope-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Portfoliokurve gehört zum GEWÄHLTEN Konto, nicht zum Betrachter.

── Woher dieser Test kommt (Marcos Fund, Nachtrag 78) ──────────────────────
„Wenn ich meinen Account wähle oder ein anderes Unterkonto, wird immer
-0,5 % angezeigt."

Ursache: Der Schlüssel des Portfolio-Schnappschusses hing an der ID des
BETRACHTERS (`'__portfolio__' + viewerId`). Wählte das Hauptkonto im Filter
ein Unterkonto, wurde trotzdem der eigene Schnappschuss gelesen — gleiche
Kurve, gleicher Prozentwert, egal was im Filter stand. Der Filter sah aus,
als täte er nichts, und genau so hat Marco es beschrieben.

Die Aussage gilt unverändert, der WEG dahin nicht mehr: Seit Nachtrag 82
gibt es die Portfolio-Schnappschüsse nicht mehr. Sie hielten fest, was AN
JENEM TAG erfasst war, und konnten die Frage „was wäre der heutige Bestand
damals wert gewesen" grundsätzlich nicht beantworten — daran hing Marcos
zweiter Fund, die +850 % durch neu erfasste Sets. Die Kurve wird jetzt für
jede Kontoauswahl aus dem Preisverlauf JE SET rekonstruiert.

Dieser Test prüft deshalb dasselbe an den Beständen statt an den
Schnappschüssen: Jedes Konto hat ein eigenes Set mit eigenem Preis, und wer
im Filter steht, entscheidet, welches davon in der Kurve landet.
```
