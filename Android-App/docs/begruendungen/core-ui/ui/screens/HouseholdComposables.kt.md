# Begründungen zu `core-ui/ui/screens/HouseholdComposables.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/screens/HouseholdComposables.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="scopefilterzeile"></a>
## `ScopeFilterZeile`

```text
Der Kontofilter, wie ihn eine Bestandsansicht zeigt: links oben, mit dem
üblichen Abstand, nur wenn es etwas zu wählen gibt. Eine Zeile für Teile,
Minifiguren und Galerie, damit ein abweichender Abstand nicht erst beim
Reiterwechsel auffällt.

Der Finanz-Reiter gehört nicht hierher: Dort steht der Filter rechtsbündig und
als Eintrag einer LazyColumn, deren `item{}` die Bedingung umschliessen muss —
eine bewusste Ausnahme, dort begründet.
```
