# Begründungen zu `public/js/18-wanted-xml.js`

Die ausführlichen Kommentare aus `public/js/18-wanted-xml.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="noch-besser-waere-wenn-es-beim-import-di"></a>
##   „noch besser wäre wenn es beim Import die zu importierende Liste

```text
═══ BrickLink-Wanted-Listen: Vorschau, Import, Export ══════════════════════

── Marcos Vorgaben vom 19.10. ──────────────────────────────────────────────

  „noch besser wäre wenn es beim Import die zu importierende Liste
   vorgängig anzeigen wurde analog der Teileliste mit Bild, Farbe,
   Bezeichnung und ich dort noch Korrekturen vornehmen kann oder z.b.
   rebrickable ids ergänzen könnte"

  „Bitte auch den Import der xml Files für wanted listen in den Sets,
   teilen und Minifiguren ergänzen und aus den Einstellungen entfernen."


── Warum eigene Datei ──────────────────────────────────────────────────────

Der Import lag in 05-settings.js, weil der Knopf dort stand. Jetzt steht er
in DREI Reitern, und der Dialog gehört in keinen von ihnen — er gehört zu
der Sache, um die es geht.
```

<a id="datei"></a>
## `_datei`

```text
Die gewählte Datei bleibt im Speicher, bis importiert oder geschlossen wird.

Sie MUSS bleiben: Der Import ist zweistufig, und der zweite Schritt schickt
dieselbe Datei erneut — mit `schreiben=1` und den Korrekturen. Den Server
die Datei zwischenspeichern zu lassen wäre die Alternative; das hiesse,
fremde Dateien auf dem Server zu halten, bis irgendwann jemand bestätigt
oder eben nie.
```

<a id="laeuft"></a>
## `_laeuft`

```text
Läuft gerade eine Anfrage an den Server?

── Marcos Vorgabe vom 20.10. ───────────────────────────────────────────────

„Wenn der Import der Wanted-Liste läuft, soll der Button nicht nochmals
 geklickt werden können."

Das ist nicht nur Kosmetik. Der zweite Schritt SCHREIBT, und er schreibt
über recordAcquisitionForDay() — eine zweite Anfrage mit derselben Datei
legt für denselben Tag keine zweite Erfassung an, sondern ADDIERT auf die
bestehende (idx_part_acq_tag_merkmale, src/bestand/acquisitions.ts). Zwei Klicks auf
„Jetzt in den Bestand übernehmen" hätten also die doppelte Stückzahl
ergeben, und zwar lautlos: Beide Antworten melden Erfolg.

Der Riegel liegt an ZWEI Stellen, weil ein Klick auf zwei Wegen ankommen
kann: `disabled` am Knopf (ein deaktivierter Knopf löst gar kein
click-Ereignis aus) und diese Abfrage in lies() selbst — gegen die
Tastatur-Eingabetaste, gegen den Dateiknopf daneben und gegen jeden
späteren Aufrufer, der den Knopf nicht kennt.
```

<a id="knoepfestand"></a>
## `knoepfeStand`

```text
Welche Knöpfe sind jetzt bedienbar? EINE Stelle für die Regel.

Vorher stand `schreibKnopf.disabled = !d.vorschau` mitten im Zeichnen des
Berichts. Käme der Riegel für „läuft gerade" als zweite Zuweisung daneben,
gäbe es zwei Stellen, die denselben Knopf schalten — und die eine würde die
andere irgendwann überschreiben (genau das passiert, wenn das Freigeben nach
dem Lauf den Knopf wieder einschaltet, den der Bericht gerade ausgeschaltet
hat).

Deshalb: Der Zustand wird aus `_laeuft`, `_datei` und `_bericht` BERECHNET,
und jeder, der einen davon ändert, ruft diese Funktion.
```

<a id="zeichnefortschritt"></a>
## `zeichneFortschritt`

```text
Den Fortschrittsbalken setzen — oder verstecken.

── Marcos Wunsch vom 20.10. ────────────────────────────────────────────────

„kannst du beim Import auch den Fortschritt mit einem Fortschrittsbalken
 anzeigen?"

Der Balken sagt ZWEI Dinge, weil zwei verschiedene Dinge dauern: das
Nachfragen bei Rebrickable (eine Anfrage je 1,5 Sekunden) und das Schreiben
der Posten. Welche Phase läuft, steht als Satz darunter — ein Balken ohne
Beschriftung liesse offen, worauf man wartet.
```

<a id="liesstrom"></a>
## `liesStrom`

```text
Die Antwort ZEILENWEISE lesen (NDJSON) und dabei den Balken füllen.

Der Server schickt mit `strom=1` erst Fortschrittszeilen und zuletzt den
Bericht — dieselbe Nutzlast wie ohne Strom (routes/api_v1/wanted.ts).

── Warum hier ein Rückfall steht ───────────────────────────────────────────

`response.body` ist in jedem Browser da, den diese App bedient, aber nicht
in jeder Laufzeit, die diesen Code ausführt — die Prüfungen laden das Bündel
in eine Sandbox, und ein `fetch`-Ersatz dort liefert nur `json()`. Fehlt der
Strom, wird die letzte Zeile am Ende in einem Stück gelesen; der Balken
bleibt dann aus, der Import läuft trotzdem.
```

<a id="kuenftig"></a>
## `kuenftig`

```text
Der Ausgang mit WORTEN. „offen" ist die Aussage, auf die es ankommt — sie
darf nicht nur eine Farbe sein.

── Vorschau und Import sagen dasselbe Wort verschieden ──────────────────

`angelegt` heisst in der Vorschau „wird angelegt" und NACH dem Import
„angelegt". Hier stand nur die erste Fassung, und sie blieb auch dann
stehen, wenn geschrieben war: GEMESSEN am laufenden Server stand nach
einem Import von 60 Posten in jeder Zeile „will be added", während die
Zusammenfassung darüber „60 added" meldete. Zwei Sätze über dieselbe
Tatsache, und einer davon war falsch.

Dieselbe Unterscheidung, die der Kern schon trifft (`vorschau` im
Bericht); nur dort, wo das Wort eine Zukunft behauptet.
```

<a id="zustandwert"></a>
## `zustandWert`

```text
── Der Zustand, und woher er kommt (Marcos Bitte vom 20.10.) ────────────

  „ja, bitte die Zustandsspalte noch in die Vorschau"

`p.zustand` ist der Wert AUS DER DATEI: 'N', 'U' oder null. Null heisst
CONDITION=X („egal") oder gar keine Angabe — dann gilt der Standard des
Kontos, und genau DER wird angelegt. Die Spalte zeigt deshalb den
angelegten Zustand und sagt dazu, wenn er aus den Einstellungen stammt:
Ein „Gebraucht" ohne diesen Zusatz waere eine Aussage ueber die Datei,
die dort nicht steht.

Der Standard kommt vom SERVER (bericht.standardZustand). Im Browser steht
er nirgends verlaesslich, und raten ist in einer Vorschau das Falsche.
```

<a id="feld"></a>
## `feld`

```text
── Die Werte aus der Datei, bearbeitbar (Marcos Wunsch vom 21.10.) ──────

  „Alle Spalten sollen bearbeitbar sein in der Vorschau, damit der Inhalt
   vor dem Import korrigiert werden kann."

Diese drei Felder sind VORBEFÜLLT — anders als die beiden Korrekturfelder
rechts, die leer anfangen. Daraus folgt eine andere Lesart: Dort heisst
leer „nicht angefasst", hier heisst JEDE Abweichung vom Ausgangswert eine
Korrektur (wantedKorrekturWert vergleicht mit dem Bericht).

Nicht bearbeitbar bleiben Bild, Name, BrickLink-Nummer und Ergebnis — die
Begründung steht am Typ `Korrektur` in src/merkliste/wantedListe.ts.
`breit` wegen des Platzhalters „Marktpreis": In 72px stand dort „Marktpr"
— am Bildschirm gesehen.
```

<a id="wantedkorrekturwert"></a>
## `wantedKorrekturWert`

```text
Ein VORBEFÜLLTES Feld der Vorschau — Menge, Zustand oder Kaufpreis.

── Marcos Wunsch vom 21.10. ───────────────────────────────────────────────

  „Alle Spalten sollen bearbeitbar sein in der Vorschau, damit der Inhalt
   vor dem Import korrigiert werden kann."

── Warum ein EIGENER Handler neben den beiden darüber ─────────────────────

wantedKorrekturNummer/-Farbe bedienen Felder, die LEER anfangen: Dort heisst
ein leeres Feld „nicht angefasst", und jeder Inhalt ist eine Eintragung.
Diese drei sind vorbefüllt mit dem, was in der Datei steht — da gibt es
kein „leer" als Nicht-Aussage. Was zählt, ist die ABWEICHUNG vom
Ausgangswert; tippt jemand den alten Wert wieder hin, verschwindet die
Korrektur.

Beides in einen Handler zu zwingen hiesse, die Unterscheidung in eine
Tabelle zu verstecken, die man beim Lesen erst auflösen muss. Zwei Lesarten
sind hier zwei Funktionen.

Beim Zustand ist der leere Wert eine AUSSAGE („Standard des Kontos",
dieselbe wie CONDITION=X) und wird deshalb als `null` geschickt, nicht
weggelassen. Beim Preis ebenso: leer heisst „keiner, hol den Marktpreis".
```

<a id="for"></a>
## `for`

```text
── Das Symbol an die drei Knöpfe hängen ───────────────────────────────────

EINE Fassung für alle drei Reiter. Die Alternative wäre, das SVG dreimal in
index.html zu schreiben — dieselbe Zeichnung an drei Stellen, von denen bei
der nächsten Änderung zwei nachgezogen werden.

Ein eigenes <span> ohne data-i18n: Die Übersetzung setzt textContent (siehe
public/i18n.js) und würde ein Symbol im selben Element wieder herauswerfen,
sobald die Sprache wechselt.
```
