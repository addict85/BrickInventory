# Begründungen zu `feature-teile/ui/screens/ManualItemDetailScreen.kt`

Die ausführlichen Kommentare aus `feature-teile/src/main/java/ch/brickinventoryapp/teile/ui/screens/ManualItemDetailScreen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="manualitemdetailroute"></a>
## `ManualItemDetailRoute`

```text
Detailansicht eines manuell erfassten Teils / einer Minifigur — als ganzer
Screen wie bei den Sets, weil der Inhalt (Bild, Mengenwahl, Kaufpreise und
Marktpreise je Zustand, Preisverlauf, Löschen) für einen AlertDialog zu lang
ist. Derselbe Aufbau wie SetDetailScreen, damit man beim Wechsel vom Set zum
Teil dieselben Dinge an denselben Stellen findet.

Erfassungen und Preisverlauf lädt `loadManualAcquisitions()`.
```
