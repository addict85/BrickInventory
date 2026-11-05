# Begründungen zu `feature-verwaltung/ui/viewmodel/MonitoringViewModel.kt`

Die ausführlichen Kommentare aus `feature-verwaltung/src/main/java/ch/brickinventoryapp/ui/viewmodel/MonitoringViewModel.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="hintergrundarbeiten"></a>
## `Hintergrundarbeiten`

```text
Der Monitoring-Bildschirm holt seine Daten über dieses ViewModel statt aus den
Composables, damit die Ladelogik ohne Compose-Laufzeit prüfbar ist. Ein eigenes
ViewModel am NavHost-Ziel (hiltViewModel()), weil der selten geöffnete
Bildschirm mit seiner Abfrageschleife nicht die Lebensdauer der Activity
braucht.

  hierher      was vom Server kommt — wird ohnehin neu geladen
  Bildschirm   was der Mensch angefasst hat (rememberSaveable)
  Bildschirm   Knopftexte eines laufenden Vorgangs — dürfen eine Drehung nicht überleben

Keine Texte hier: Die Funktionen sagen, was passiert ist; den Satz wählt die
Anzeige, wie in FehlerTexte.kt.
```
