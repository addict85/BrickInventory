# Begründungen zu `public/js/10-mobile.js`

Die ausführlichen Kommentare aus `public/js/10-mobile.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="ergaenzt-mobile-css-um-die-zwei-dinge-di"></a>
## Ergänzt mobile.css um die zwei Dinge, die sich nicht rein deklarativ lösen

```text
═══ MOBILE-VERHALTEN ═══════════════════════════════════════════════════════

Ergänzt mobile.css um die zwei Dinge, die sich nicht rein deklarativ lösen
lassen. Läuft auf jeder Bildschirmgrösse, tut aber nur auf schmalen etwas.

1. Tabellen-Beschriftungen
   mobile.css verwandelt jede .dt-Tabelle unter 640px in eine Kartenliste.
   Damit man dann noch weiss, welcher Wert wozu gehört, braucht jede <td>
   die Beschriftung ihrer Spalte in data-label — das CSS blendet sie über
   ::before ein.

   Statt alle zehn Tabellen-Templates in sechs Dateien anzufassen (und
   künftige zu vergessen), stempelt ein MutationObserver die Attribute
   nachträglich. Er liest die <th>-Texte des zugehörigen <thead> und
   verteilt sie spaltenweise. Neue Tabellen bekommen das Verhalten damit
   automatisch, ohne dass jemand daran denken muss.

2. Aktiver Reiter im Blick
   Die Navigation ist auf dem Telefon horizontal scrollbar. Nach einem
   Tabwechsel — oder direkt nach dem Login, wenn ein hinterer Reiter aktiv
   ist — steht der aktive Eintrag sonst ausserhalb des sichtbaren Bereichs.
```

<a id="start"></a>
## `start`

```text
Bedingung ist das Vorhandensein von <body>, nicht der readyState: Das
Skript steht am Ende des Body, dort ist der Baum bereits da und die
Beschriftungen greifen noch vor dem ersten Paint. Auf DOMContentLoaded zu
warten wäre nicht nur unnötig spät — würde das Skript jemals NACH diesem
Ereignis geladen (nachträglich eingefügt, defer-Sonderfälle), liefe die
Initialisierung überhaupt nicht mehr an.
```
