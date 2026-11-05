# Begründungen zu `public/js/05-lagerorte.js`

Die ausführlichen Kommentare aus `public/js/05-lagerorte.js` (bis zur Teilung in `public/js/05-settings.js`), wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="marcos-befund-dass-die-felder-alle-schoe"></a>
## Marcos Befund: „dass die Felder alle schön gleich ausgerichtet sind wie in

```text
── Vier Spalten wie in einer Tabelle ───────────────────────────────────

Marcos Befund: „dass die Felder alle schön gleich ausgerichtet sind wie in
einer Tabelle? aktuell sind sie alle unterschiedlich lang".

Vorher war jede Zeile ein eigenes Flexfeld mit `flex:1` auf dem
Eingabefeld. Der Platz, der dem Feld blieb, haengt damit an der LAENGE DES
BELEGUNGSTEXTES daneben — „406 Sets, 0 Teilesorten, 0 Figuren" ist
breiter als „leer", und das Feld daneben entsprechend schmaler.

Jetzt traegt die LISTE das Raster und die Zeilen sind display:contents.
Damit teilen sich alle Zeilen dieselben vier Spaltenbreiten: Das Feld
nimmt den Rest (minmax(0,1fr) — nicht 1fr, sonst sprengt ein langer Name
die Spalte), die drei anderen genau so viel, wie ihr laengster Inhalt
braucht.

Der Trennstrich sass an der Zeile. Ein display:contents-Element erzeugt
keinen Kasten und kann keinen Rahmen tragen — er liegt deshalb an jeder
Zelle und ergibt zusammen dieselbe durchgehende Linie.
```

<a id="schaltelagerortvorgabe"></a>
## `schalteLagerortVorgabe`

```text
Den Stern umschalten.

── Warum der Stern und nicht eine Farbe ────────────────────────────────────

★ und ☆ unterscheiden sich in der FORM. Marco ist rot-gruen-schwach; ein
farbig hervorgehobener Eintrag waere fuer ihn kein Unterschied. Dazu tragen
beide Zustaende einen eigenen Titel (und aria-pressed), damit die Aussage
auch dort ankommt, wo niemand hinsieht.

`war` kommt aus dem Knopf: Der zweite Druck auf denselben Stern schaltet die
Vorgabe ab. Ein eigener Knopf dafuer waere ein zweites Bedienelement fuer
eine Frage mit zwei Antworten.
```
