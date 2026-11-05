# Begründungen zu `core-data/data/cache/ResponseCache.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/data/cache/ResponseCache.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="responsecache"></a>
## `ResponseCache`

```text
Plattenspeicher für API-Antworten, damit die App nach dem Start gefüllt ist und
offline benutzbar bleibt.

Kein Room: Die App fragt ganze Listen ab und ersetzt sie ganz — keine
Teilaktualisierungen, keine Joins, keine Abfragen über den Cache. Alle Modelle
sind schon @Serializable, so braucht der Cache keine neue Abhängigkeit und keine
Entities, DAOs oder zweite KSP-Verarbeitung.

Geschrieben wird bei jeder erfolgreichen Antwort, gelesen nur, wenn der
Netzabruf fehlschlägt — der Server bleibt die Wahrheit. Einträge tragen eine
Formatversion: Ändert sich ein Modell, wird VERSION erhöht und alles Alte
verworfen. Jede Ablage gehört einem Bereich aus Server und Sitzung
([CacheBesitzer]), damit ein Abruf nie Einträge eines anderen Kontos oder
Servers findet. Der Hauptkonstruktor ist öffentlich, weil die Testhilfen
(core-testing) ihn mit eigenem Ordner bauen; Hilt nimmt den darunter.
```
