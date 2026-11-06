# Begründungen zu `public/js/13-set-teile.js`

Die ausführlichen Kommentare aus `public/js/13-set-teile.js` (bis zur Teilung in `public/js/13-acquisition-modals.js`), wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

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

<a id="blickfeld-mitgeben-wie-ueberall-im"></a>
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

<a id="lagerort-nur-fuer-teile-eine"></a>
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
