# Begründungen zu `public/js/13-acquisition-modals.js`

Die ausführlichen Kommentare aus `public/js/13-acquisition-modals.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="diese-708-zeilen-standen-in-js-07-admin"></a>
## Diese 708 Zeilen standen in js/07-admin.js, deren Kopfzeile als Inhalt

```text
═══ Kaufpreis-Modal und Detailfenster für manuelle Einträge ════════════════

── Warum eigene Datei ────────────────────────────────────────

Diese 708 Zeilen standen in js/07-admin.js, deren Kopfzeile als Inhalt
„Confirm-Dialog, Config-Export/Import, API-Tokens, Job-Status" nennt. Keines
der beiden Fenster hier ist Administration: Das eine erfasst Kaufpreise zu
einem Set, das andere zeigt Details zu manuell erfassten Teilen und
Minifiguren. Sie lagen dort, weil 07-admin.js über die Zeit die Datei war, in
die Neues fiel — 1492 Zeilen, benannt nach ihrer Geschichte.

Die Schnittstelle ist schmal und war es schon vorher: Drei Helfer kommen aus
07-admin.js herüber (confirmDelete, renderMarketRows, priceChartSVG), und
hinaus geht renderAcquisitionSummary. Genau das machte den Schnitt möglich,
ohne irgendetwas umzubauen.
```

<a id="acq-modal"></a>
## `acq-modal`

```text
HINWEIS: Hier stand eine ZWEITE, kürzere Fassung von closeAcqModal().
Als klassisches Skript war die doppelte Deklaration erlaubt — die spätere
(weiter unten, mit der vollständigen Rückkehr-Logik für _acqManItem UND
_acqModalSn) hat sie stillschweigend überschrieben. Die kurze Fassung war
also seit jeher toter Code und ist entfernt; im ES-Modul wäre sie ohnehin
ein harter Fehler ("Duplicate top-level function declarations").
```

<a id="eigentuemerwechsel-verschieben-genau-die"></a>
## Eigentümerwechsel = Verschieben genau dieser einen Kaufpreis-Zeile.

```text
Eigentümerwechsel = Verschieben genau dieser einen Kaufpreis-Zeile.
KEIN from_user_id: Den Absender ermittelt der Server aus der Zeile
selbst (acquisitionMoveSource). Hier stand der BETRACHTER — für die
Zeile eines Unterkontos suchte der Server sie damit unter dem falschen
Konto und antwortete 404, obwohl das Select den richtigen Eigentümer
längst anzeigte.
```

<a id="loadgallery"></a>
## `loadGallery`

```text
Kennzahlen, Galerie und Finanzen mitziehen.

Vorher aktualisierte diese Funktion nur die beiden Dialoge. Kaufpreis und
Menge einer Erfassung wirken aber auf die Galerie-Kachel (Preis-Badge) und
auf die Finanzauswertung — beide blieben auf dem alten Stand, bis der Reiter
neu geladen wurde. Dieselbe Ursache wie bei manQtySave() und in der
Android-App bei updateAcquisition().
restore wie beim Eigentümerwechsel: Auch ein Preis- oder Mengenwechsel im
Dialog darf die gescrollte Tiefe nicht kosten.
```

<a id="rawimgsrc"></a>
## `rawImgSrc`

```text
War: fullUrl(...) allein — bei einer CDN-Quelle ohne imgUrl()-Umwicklung
lädt der Browser direkt von Rebrickable, am Server vorbei. Das ist der
eigenständige Kaufpreis-Detail-Dialog für manuell erfasste Teile/
Minifiguren — ein anderer Ort als die Kachel-Zoom-Funktion in 03-parts.js/
06-minifigs.js, die bereits korrigiert wurde. Jetzt wie dort: über den
Server-Proxy, volle Auflösung ohne &thumb=1.
```

<a id="if-2"></a>
## `if`

```text
── Farbe (nur Teile) — ÄNDERBAR ────────────────────────────────────────

Marcos Bitte vom 19.10.: „Weiter möchte ich die Farbe nachträglich
anpassen können für den Fall dass diese nicht korrekt geladen wurde."

Hier stand die Farbe als Text, mit dem Kommentar „read-only". Die Bedingung
war dazu `item.color_name` — ausgerechnet ein Teil OHNE Farbbezeichnung,
also genau der Fall, der korrigiert werden muss, zeigte die Zeile gar
nicht an.

Die Auswahlliste ist dieselbe wie beim Erfassen (loadBrickColors, aus
/v1/parts/brick-colors). Sie wird NACH dem Zeichnen gefüllt: Der Abruf
geht übers Netz, und der Dialog soll nicht darauf warten — bis dahin
steht die heutige Farbe als einzige Möglichkeit da.
```

<a id="ladeortauswahl-2"></a>
## `ladeOrtAuswahl`

```text
── Lagerort ─────────────────────────────────────────────────────────────

Marcos Befund vom 24.09.: „Auf dem Detail Dialog der manuell erfassten
Teile ist der Lagerort nicht ersichtlich. Auf dem Detaildialog der manuell
erfassten Minifiguren ist das Lagerort nicht ersichtlich." Er vermutete
es auch in der Webapp — zu Recht: Die Zeile gab es nur im Dialog der Teile
AUS SETS (setitem-storage) und im Set-Detail.

Dasselbe Bedienelement und derselbe Speicherweg wie dort; nur die Adresse
haengt am Typ. Die Auswahlliste gehoert dem BESITZER des Eintrags, nicht
dem Betrachter — im Haushalt zeigt der manuelle Bereich die Eintraege
aller Konten.
```

<a id="preisverlauf-wie-im-set-detail-beide-zus"></a>
## Preisverlauf — wie im Set-Detail, beide Zustände in einem Diagramm.

```text
Preisverlauf — wie im Set-Detail, beide Zustände in einem Diagramm.

Die Verlaufstabellen für Teile und Figuren sind neu (db/migrations/0003);
vorher speicherte der Cache nur den zuletzt abgerufenen Preis. Das
Diagramm bleibt deshalb eine Weile leer, bis genug Punkte gesammelt sind —
das ist erwartet und kein Fehler.
Marktpreis je Zustand — oberhalb des Diagramms, wie im Set-Detail.
```

<a id="opensetitemdetail"></a>
## `openSetItemDetail`

```text
═══ Detail-Dialog fuer Teile und Figuren AUS SETS ═════════════════════════

── Marcos Wunsch ──────────────────────────────────────────────────────────
„Kannst du noch einbauen, dass auch die automatisch erfassten Teile und
Minifiguren einen Detail-Dialog inkl. Zoom haben? Der Marktpreis kann
weggelassen werden. Die Anzahl soll nicht geändert werden können. Dafür soll
angezeigt werden, welche Sets dieses Teil und Minifigur verwenden — inkl.
Link, um den Detail-Dialog des Sets öffnen zu können."

── Warum derselbe Rahmen wie openManDetail ────────────────────────────────
Es ist dieselbe Frage („was ist das für ein Teil?"), nur eine andere
Herkunft. Zwei verschieden aussehende Dialoge für dieselbe Sache wären genau
das Gegenteil von „einheitliche Ansichten". Geteilt werden deshalb der
Modal-Rahmen, die Kopfzeile, das Bild samt Zoom (data-orig, 11-actions.js)
und detailZeile(); unterschiedlich ist nur, WAS darin steht.

Der Löschknopf wird ausgeblendet: Ein Teil aus einem Set löscht man nicht
einzeln — es verschwindet mit dem Set. Der Knopf säße hier also für eine
Handlung, die es nicht gibt.

── Warum EIN Aufruf und keine Daten aus dem DOM ───────────────────────────
Die Kacheln der automatischen Liste halten keinen Zwischenspeicher (sie
hängt HTML seitenweise an). Die Felder aus der angeklickten Kachel
zurückzulesen wäre möglich und brüchig — jede Änderung am Kachel-Aufbau
bräche den Dialog still.

Stattdessen liefert /v1/parts/:nr/:farbe/sets (bzw. /v1/minifigs/:nr/sets)
BEIDES aus derselben Abfrage: das Teil selbst und die Sets, in denen es
steckt. Eine zweite Quelle für den Kopf könnte etwas anderes sagen als die
Liste darunter.
```

<a id="url"></a>
## `url`

```text
Blickfeld mitgeben wie überall sonst — im Haushalt gehört das Set des
Geschwisterkontos dazu, sonst sagt der Dialog etwas anderes als die Liste,
aus der man kommt.

scopeQuery() ANGEHAENGT statt in die Zeichenkette hinein: Genau so machen
es die übrigen Aufrufe, und test/frontend-api-paths.test.js liest die
Adresse aus dem Quelltext. Ein `${…}` am Ende las es als Teil des Pfades
(„/sets:x — keine passende Route") und meldete den Aufruf als ins Leere
gehend. Der Waechter hatte recht mit seiner Form, nicht mit dem Befund —
die einheitliche Schreibweise löst beides.
```

<a id="anzahl-nur-anzeige-marcos-vorgabe-eine-m"></a>
## Anzahl: NUR Anzeige. Marcos Vorgabe — eine Menge, die aus den Inventaren

```text
Anzahl: NUR Anzeige. Marcos Vorgabe — eine Menge, die aus den Inventaren
der Sets entsteht, lässt sich hier nicht sinnvoll ändern.
fmtN() ist der GELDformatierer. Hier stand `fmtN(total_quantity)` ohne
Waehrung — aus der Menge 6 wurde damit „EUR 6.00×". Anzahlen schreibt
dieser Baum als `(n||0).toLocaleString(locale())`; genau so steht es auf
der Teilekachel (03-parts.js), und der Dialog zeigt jetzt dasselbe.
```

<a id="if"></a>
## `if`

```text
── Lagerort ──────────────────────────────────────────────────────────────

Nur für Teile, nicht für Figuren: Eine Minifigur steckt in ihrem Set, und
dessen Lagerort steht im Set-Detail. Ein zweiter Ort für dieselbe Sache
wäre eine Stelle, an der zwei Antworten auseinanderlaufen können.

Das Feld schreibt auf ALLE Zeilen dieses Teil-Farb-Paares (siehe die
Route): Dasselbe Teil steckt in mehreren Sets, und wer hier „Kiste 3"
einträgt, meint das Teil — nicht eine seiner Zeilen.
```

<a id="ladeortauswahl"></a>
## `ladeOrtAuswahl`

```text
Die Auswahlliste gehört dem BESITZER des Teils, nicht dem Betrachter —
dieselbe Regel wie beim Set, Begründung an ladeOrtAuswahl().

`owner_ids` und nicht `owners`: Eine gruppierte Teilezeile trägt keine
Besitzerplakette (withOwners lässt sie bewusst in Ruhe). Der Kopf des
Dialogs führt die Konten deshalb selbst — verdichtet aus denselben
Zeilen, aus denen die Set-Liste darunter entsteht.
```

<a id="setbild"></a>
## `setBild`

```text
── Die verwendenden Sets ────────────────────────────────────────────────
Jede Zeile öffnet das Set-Detail. `openSetAusItem` schliesst diesen Dialog
zuerst — zwei offene Fenster übereinander wären nicht mehr zu schliessen.
── Eine Tabelle, wie im Reiter Finanzen ─────────────────────────────────

Marcos Vorgabe: Bild, Nummer, Bezeichnung — in Spalten, nicht als Fliesstext.
Vorher standen Nummer und Name direkt nebeneinander („8480-1 Space
Shuttle"), ohne Bild und ohne gemeinsame Kante; bei mehreren Sets stand
jeder Name woanders.

Die Bilder liefert der Server je Set bereits mit (src/bestand/gemeinsam.ts,
verwendendeSets → image_local/image_url) — sie wurden hier nur nie
benutzt. Die Adresse entsteht genauso wie in 04-finance.js: Vorschau, wenn
es eine gibt, sonst das Original; `data-orig` traegt die volle Aufloesung
fuer den Zoom.

Die Menge bleibt als vierte Spalte stehen — sie beantwortet „wie oft steckt
das Teil in DIESEM Set?", und diese Zahl gibt es sonst nirgends.
```

<a id="marcos-befund-am-bild-der-text-verwendet"></a>
## Marcos Befund am Bild: „Der Text 'Verwendet in' kommt in das erste Bild

```text
── Warum die Tabelle UNTER der Beschriftung steht ────────────────────────

Marcos Befund am Bild: „Der Text 'Verwendet in' kommt in das erste Bild
der Sets." Die Zeile ist ein `.dr` und damit ein Flex-Kasten mit
`justify-content:space-between` (styles.css): Beschriftung links, Wert
rechts. Bei EINEM Set ist die Tabelle so schmal, dass sie neben die
Beschriftung rutscht und das Vorschaubild sie beruehrt.

`flex-direction:column` an der ZEILE stellt beides untereinander — die
Tabelle beginnt damit immer auf einer neuen Zeile, gleich wie viele Sets
es sind. Die Android-App macht das seit jeher so (SetItemDetailDialog.kt:
erst der Text, dann die LazyColumn darunter); hier war die Webapp die
Abweichung.
```

<a id="speichereteillagerort"></a>
## `speichereTeilLagerort`

```text
Lagerort eines Teils oder einer Figur speichern.

Beim Verlassen des Feldes, aus demselben Grund wie beim Set (07-admin.js):
Ein Ortsname wird getippt, und ein Speichern je Zeichen hinterliesse für
„Kiste 3" fünf Zwischenstände in der Datenbank.

── Warum `this` und nicht mehr eine feste Kennung ──────────────────────────

Hier stand `G('setitem-storage')`. Damit war der Handler an EINEN Dialog
gebunden — der Detaildialog der manuell erfassten Einträge (Marcos Befund
vom 24.09.: „Auf dem Detail Dialog der manuell erfassten Teile ist der
Lagerort nicht ersichtlich") hätte einen zweiten mit derselben Regel
gebraucht. Die Delegation ruft den Handler mit dem Element als Empfänger
auf (11-actions.js, fn.apply(el, args)); `this` ist also das Feld, das
gerade verlassen wurde.

`data-typ` entscheidet die Adresse: Eine Figur hat keine Farbe und deshalb
eine eigene Route (routes/api_v1/minifigs.ts).
```

<a id="fuellefarbwahl"></a>
## `fuelleFarbwahl`

```text
Die Auswahlliste der Farben im Detaildialog füllen.

Getrennt vom Zeichnen, weil /v1/parts/brick-colors beim ERSTEN Mal über das
Netz geht (Rebrickable, danach im Modul gehalten). Der Dialog steht
derweil schon offen und zeigt die heutige Farbe.

Schlägt der Abruf fehl, bleibt die eine Möglichkeit stehen: eine Liste mit
nur der aktuellen Farbe ändert nichts — besser als eine leere Liste, in der
die Farbe des Teils gar nicht mehr vorkommt.
```

<a id="speichereteilfarbe"></a>
## `speichereTeilFarbe`

```text
Die Farbe eines manuell erfassten Teils ändern.

Was dabei in der Datenbank passiert — Umziehen oder Zusammenlegen, und was
mit den Erfassungen geschieht — steht an einer Stelle:
src/teile/teilFarbeAendern.ts.

Danach wird der Dialog mit der NEUEN Farbe neu geöffnet. Die Farbe ist Teil
der Kennung des Eintrags (Adresse: /parts/:nr/:farbe); ohne das zeigte der
offene Dialog weiter auf eine Zeile, die es nicht mehr gibt, und der
nächste Klick darin ginge ins Leere.
```

<a id="acqurl2"></a>
## `acqUrl2`

```text
Erfassungsliste IMMER neu laden — in beide Richtungen.

── Was vorher falsch war ─────────────────────────────────────────────────
Hier stand `if (qty > prevQty)`, also nur beim Erhöhen. Das erzeugte zwei
Fehlerbilder, die wie zwei verschiedene Fehler aussahen:

  • Menge REDUZIEREN: Der Server entfernt (bzw. verkleinert) die heutige
    Erfassung per LIFO — die Anzeige lud aber nie neu und zeigte den
    gelöschten Eintrag weiter an.

  • Menge ERHÖHEN: prevQty kam aus manualPartsCache/manualFigsCache und
    wurde bei Teilen NUR über part_number gesucht — ohne color_id. Bei
    einem Teil in mehreren Farben traf das die falsche Zeile; fand es gar
    nichts (Teil nicht in der geladenen Seite der paginierten Liste), fiel
    der Ausdruck auf inp.value zurück. Das ist zu diesem Zeitpunkt aber
    bereits der NEUE Wert, weil manQtyChange() ihn vor dem Aufruf setzt —
    `qty > prevQty` war damit `qty > qty`, also falsch, und es wurde
    ebenfalls nicht nachgeladen.

prevQty ist ersatzlos entfallen: Ein GET auf die Erfassungen kostet nichts
und die Antwort ist die einzige verlässliche Quelle dafür, was jetzt in der
Datenbank steht. Eine Bedingung, die raten muss, ob sich etwas geändert
hat, ist hier schlicht die falsche Konstruktion.
```
