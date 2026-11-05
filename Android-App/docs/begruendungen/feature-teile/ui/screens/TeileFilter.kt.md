# Begründungen zu `feature-teile/ui/screens/TeileFilter.kt`

Die ausführlichen Kommentare aus `feature-teile/src/main/java/ch/brickinventoryapp/ui/screens/TeileFilter.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="teilefilterzeile"></a>
## `TeileFilterZeile`

```text
Farbe und Kategorie als zwei aufklappbare Filter — wie die beiden Filterlisten
der Webapp (03-parts.js, `loadPartsFilters` → `#color-filter` und
`#cat-filter`), jede mit der Anzahl daneben. `getParts` reicht `color` und
`category` an den Server.

Ein Blatt statt einer langen Liste: Die Webapp hat eine Seitenspalte; auf dem
Telefon schöben zwei Blöcke den Bestand nach unten. Ein Chip mit der aktuellen
Wahl und ein Blatt zum Ändern ist derselbe Weg wie beim Thema im Katalog
(CatalogThemeSheet).
```
