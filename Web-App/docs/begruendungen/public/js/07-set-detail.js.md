# Begründungen zu `public/js/07-set-detail.js`

Die ausführlichen Kommentare aus `public/js/07-set-detail.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="pricerow"></a>
## `priceRow`

```text
Marktpreis und Entwicklung stehen jetzt JE ZUSTAND — und die Werte dafür
kommen aus derselben Abfrage wie der Preisverlauf (by_condition). Hier nur
der Platzhalter; gefüllt wird er in renderMarketRows() weiter unten,
sobald die Antwort da ist.

Vorher standen hier zwei feste Zeilen aus _pnlCache — ein Wert für das
ganze Set. Wer ein Exemplar neu und eines gebraucht besitzt, sah damit eine
vermischte Entwicklung.
```

<a id="api"></a>
## `api`

```text
Load actual minifig count from minifigs table (more reliable than sets.minifigs)

── Wettlauf mit dem Schliessen des Dialogs ──────────────────────────────
Marcos Konsole: `TypeError: Cannot read properties of null (reading
'minifigs')`, als [promise] gemeldet — also aus einer Fortsetzung wie
dieser.

Die Abfrage über ALLE Minifiguren dauert; wer den Dialog vorher schliesst
(closeModal setzt curSet auf null) oder ein anderes Set öffnet, lief hier
in den Fehler. Das Element gab es dann teils noch — die Prüfung auf `el`
allein genügt also nicht.

Deshalb wird die Setnummer von damals mit der von jetzt verglichen: Nur
wenn noch DASSELBE Set offen ist, gehört das Ergebnis dorthin.
```

<a id="echt"></a>
## `echt`

```text
Die WIRKLICHE Gesamtmenge kommt vom Server.

Angezeigt wird die Menge aller Konten, geschrieben wird die Differenz
auf das eigene. Beim VERRINGERN deckelt der Server bei den eigenen
Exemplaren — fremde lassen sich nicht wegnehmen —, und dann steht in
der Antwort eine andere Zahl als die gesendete. Ohne diese Übernahme
bliebe im Feld die eigene Annahme stehen, bis der Dialog neu geöffnet
wird.
```
