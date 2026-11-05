# Begründungen zu `feature-katalog/ui/screens/CatalogScreen.kt`

Die ausführlichen Kommentare aus `feature-katalog/src/main/java/ch/brickinventoryapp/ui/screens/CatalogScreen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="launchedeffect"></a>
## `LaunchedEffect`

```text
── Laden, was gerade sichtbar wird ──

Die Liste führt alle `total` Plätze; geladen wird die Seite eines sichtbar
gewordenen Platzes, mit einer Seite Vorlauf — so kann die Leiste rechts
überallhin springen. Erst wenn die Liste ruht: Die Leiste rollt beim Ziehen
durch jede Zwischenposition, und ohne Ruhe stünde die Zielseite hinter Hunderten
angeforderter Seiten in der Schlange. Die Ruhe hält der Sichtfensterlader im ViewModel.
```

<a id="wiederhergestellt-by-remember"></a>
## `wiederhergestellt by remember`

```text
── Die Rollposition überlebt den Wechsel zur Detailseite ──

Die Liste verlässt beim Wechsel die Komposition und ihre Länge trifft erst
später ein, deshalb hilft Compose' Wiederherstellung nicht. Die Stelle steht im
Zustand (ViewModel); beim Betreten wird einmal zurückgesprungen, sobald die
Länge da ist, und erst danach gemeldet — sonst überschriebe die frische Null die
gemerkte Stelle. `remember`, nicht `rememberSaveable`: Der Merker gilt je
Komposition; überlebte er den Ausflug, spränge die Rückkehr nie mehr zurück.
```
