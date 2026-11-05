# Begründungen zu `public/js/02-konten-orte.js`

Die ausführlichen Kommentare aus `public/js/02-konten-orte.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="subs"></a>
## `subs`

```text
Einträge: Alle Konten, Eigene, dann JEDES Unterkonto namentlich.

Der Sammelposten „Unterkonten" ist auf Marcos Wunsch entfallen: Er
beantwortete nur „nicht mir" und stand zwischen zwei Einträgen, die
dieselbe Frage genauer beantworten. Bei zwei Kindern war die Auswahl
damit fünf Zeilen lang, von denen eine nichts hinzufügte.

Der Server versteht `accounts=subs` weiterhin (src/haushalt/haushalt.ts) — eine
ältere App-Fassung auf einem Gerät schickt es sonst ins Leere.
```

<a id="subsbox"></a>
## `subsBox`

```text
Die Teileliste hat kein Auswahlfeld, sondern eine Wahl mit zwei
Möglichkeiten („Unterkonten mit einbeziehen", index.html). Sie beantwortet
dort dieselbe Frage und gehorcht deshalb derselben Regel: Wer keine
Unterkonten hat, bekommt sie nicht zu sehen — ein Schalter ohne Wirkung
ist schlechter als keiner.

Hier und nicht in 08-init.js, weil `isMain` genau hier feststeht: Es
ergibt sich aus der Haushaltsantwort, die diese Funktion ohnehin schon
gelesen hat. Ein zweiter Abruf dafür wäre eine zweite Wahrheit.
```

<a id="for"></a>
## `for`

```text
Alle drei Erfassen-Formulare: Set, manuelles Teil, manuelle Minifigur.
Dieselbe Liste, dieselbe Regel — ein Kaufpreis für ein Kind zu erfassen
soll für alle drei gleich gehen.
cat-m-owner dabei — der Katalog-Dialog ist der vierte
Erfassungsweg und war als einziger nicht angeschlossen.
mk-owner ist der fuenfte Erfassungsweg (Merkliste) — dieselbe Liste,
dieselbe Regel. Der Grossvater traegt einen Wunsch fuer den Enkel ein.
```

<a id="erfassungs-ortfelder"></a>
## `ERFASSUNGS_ORTFELDER`

```text
Die Lagerortfelder der fuenf ERFASSUNGSWEGE einmal zeichnen.

── Marcos Befund vom 24.09. ────────────────────────────────────────────────

„Wenn ich ein Set in der Galerie hinzufuegen will, kann ich den Lagerort
nicht waehlen. Egal ob ich das manuell oder per Barcode hinzufuege. Bei den
manuell erfassten Teilen kann ich beim Erfassen keinen Lagerort setzen. Bei
manuelle erfassten Minifiguren kann ich beim Erfassen keinen Lagerort
setzen." Dazu die beiden Wege in die Galerie, aus dem Katalog und aus der
Merkliste.

── Warum hier und nicht fuenfmal im HTML ───────────────────────────────────

Das Bedienelement ist zusammengesetzt (Auswahl + Textfeld fuer einen neuen
Ort) und steht als EINE Fassung in lagerortBlock() — dieselbe, die die
Detailansichten benutzen. Fuenfmal von Hand ausgeschrieben waeren fuenf
Fassungen, die auseinanderlaufen koennen.

Gezeichnet wird zusammen mit der Kontoauswahl, weil beides denselben Anlass
hat: Der Haushalt ist geladen, die Erfassungsformulare stehen. setzeOrtVorrat()
zieht die Auswahlen danach von selbst nach, sobald der Vorrat eintrifft —
sie tragen data-ortauswahl.
```

<a id="ladelagerortvorgabe"></a>
## `ladeLagerortVorgabe`

```text
Die Vorgabe holen und die Erfassungsfelder darauf stellen.

── Warum ein eigener Abruf und nicht der Vorrat von ladeLagerorte() ────────

ladeLagerorte() liest /v1/storage — das sind die BELEGTEN Orte mit ihrer
Anzahl, und die Antwort hat keine Vorgabe (sie ist je Konto, die Uebersicht
spannt das ganze Blickfeld). Die Vorgabe steht in /v1/storage/locations,
also beim Vorrat, zu dem sie gehoert.

Das Vorbild ist initDefaultCondition() in 01-core.js: Derselbe Gedanke —
eine Einstellung aus den Einstellungen belegt die Erfassungsformulare vor —,
nur fuer den Ort statt fuer den Zustand.

NACHZIEHEN, weil die Felder schon stehen: Sie werden mit dem Haushalt
gezeichnet, die Antwort kommt ueber das Netz. Nachgezogen wird aber nur, was
noch LEER ist; wer in der Zwischenzeit selbst etwas gewaehlt hat, behaelt es.
```

<a id="leerelagerortfeld"></a>
## `leereLagerortFeld`

```text
Das Lagerortfeld eines Erfassungswegs auf den Ausgangszustand stellen.

Beim Oeffnen des Formulars, wie Anzahl und Kaufpreis auch: Ein Ort von
vorhin sieht aus wie eine Vorgabe, ist aber ein Rest.

Seit es Marcos Stern gibt, ist der Ausgangszustand nicht mehr zwangslaeufig
leer: Gibt es eine Vorgabe, steht SIE wieder da. Genau das ist der Sinn der
Sache — und deshalb heisst die Funktion nicht mehr „leeren", sondern stellt
den Anfang wieder her.

Gezeichnet statt gesetzt: ortOptionen() legt fuer einen Ort, den der Vorrat
noch nicht kennt (die Liste kommt ueber das Netz), eine eigene Option an.
Setzte man nur `sel.value`, stuende die Auswahl auf „—", waehrend im
Textfeld der Ort steht — ein Feld mit zwei Aussagen.
```

<a id="selectedstorage"></a>
## `selectedStorage`

```text
Der gewaehlte Lagerort eines Formulars — `''`, wenn keiner dasteht.

── Warum `''` und nicht `undefined` (Marcos Befund vom 20.10.) ─────────────

Hier stand `wert || undefined`. Damit fiel der Schluessel aus dem Rumpf, und
der Server sah zwei voellig verschiedene Lagen gleich:

  - ein Formular, in dem jemand die vorbefuellte Vorgabe weggeraeumt hat,
  - ein Import, der von Lagerorten ueberhaupt nichts weiss.

Seit ortFuerNeuerfassung() (src/bestand/lagerort.ts) die Vorgabe auch
serverseitig einsetzt, ist das ein Unterschied: Die zweite Lage SOLL die
Vorgabe bekommen, die erste nicht. Ein leeres Feld sagt es deshalb
ausdruecklich, statt zu schweigen.

Fuer das Anlegen selbst aendert sich nichts: normalisiereLagerort('') ist
weiterhin null, und bei null wird kein Ort geschrieben.
```
