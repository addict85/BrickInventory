# Begründungen zu `core-data/alarm/Alarmeingabe.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/alarm/Alarmeingabe.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="alarmeingabe"></a>
## `Alarmeingabe`

```text
Was aus dem, was jemand ins Schwellenfeld tippt, wird. Gespeichert wird beim
Tippen, entprellt, wie der Kaufpreis — nicht erst beim Fokusverlust: Am Telefon
tippt man die Zahl, schliesst die Tastatur und geht zurück, und dieser
Fokuswechsel kommt nie. Ohne Ruhezeit legte „249.90“ unterwegs Schwellen an, die
niemand wollte; mit [RUHE_MS] bleibt die letzte.

Hier und nicht im Bildschirm, weil sich ein Compose-Feld ohne Android nicht
ausführen lässt, diese Umrechnung schon — und sie trägt die teuerste
Entscheidung: Ein leeres Feld löscht den Alarm.
```

<a id="zahl"></a>
## `zahl`

```text
Die getippte Zeichenkette als Zahl — oder `null`, wenn der Alarm weg soll. Das
Feld zu leeren ist die natürliche Geste, einen Alarm loszuwerden; ein eigener
Knopf wäre ein zweiter Weg für dieselbe Absicht.

Das Komma wird zum Punkt: Auf einer deutschen Tastatur tippt man „249,90“, ohne
diese Zeile wäre das ein Löschen. Ein halber Anfang („-“, „abc“, „,“) ergibt
`null`. „249.“ dagegen nicht: `Double.parseDouble("249.")` ist 249.0, wie
`parseFloat` in der Webapp — beide setzen dort eine Schwelle.
```
