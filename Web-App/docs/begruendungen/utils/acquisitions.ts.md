# Begründungen zu `utils/acquisitions.ts`

Die ausführlichen Kommentare aus `utils/acquisitions.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Kaufpreis-Erfassungen schreiben — für Sets, manuelle Teile und Minifiguren.

── DIE REGEL ───────────────────────────────────────────────────────────────

  Pro Tag, Element und Benutzer gibt es genau EINEN Kaufpreis.

Ein Element ist ein Set, ein manuell erfasstes Teil oder eine manuell
erfasste Minifigur — die Regel ist für alle drei dieselbe, nur der Schlüssel
unterscheidet sich (Setnummer / Teilenummer + Farbe / Figurennummer).

Wer dasselbe Element an einem Tag zweimal erfasst, bekommt keine zweite
Zeile, sondern die bestehende mit Menge 2.

Gemeldet an einem manuell erfassten Teil: zweimal „×1 · Neu · CHF 0.60 ·
9.8.2026" untereinander im Detail-Dialog. Zwei Zeilen für denselben Kauf am
selben Tag zum selben Preis sagen nichts aus, was eine Zeile mit Menge 2
nicht besser sagte — und in der Finanztabelle stünden sie seit hardened-90
auch zweimal.

── Der Schlüssel ist Eintrag + Tag + ZUSTAND (seit dem 21.10.) ─────────────
Ein Tag und ein Zustand, eine Zeile. Wer am selben Tag dasselbe Stück
einmal neu und einmal gebraucht kauft, bekommt ZWEI Zeilen — mit ihren
eigenen Preisen.

── Warum das eine verworfene Fassung zurückholt ────────────────────────────

Marcos Befund vom 21.10.: „wenn das Teil und Farbe bereits existiert und nur
der Zustand anders ist, einen neuen Preis erzeugen mit einem anderen
Zustand."

Hier stand das Gegenteil, und der Absatz nannte auch den Grund: Eine frühere
Fassung mit Zustand im Schlüssel war verworfen worden, „weil die
Datums-Endpunkte für Sets, Teile und Minifiguren einen zweiten Eintrag am
selben Tag ohnehin alle drei abweisen, ohne den Zustand anzusehen. Zwei
Regeln, die sich widersprechen, sind schlimmer als die weniger feine von
beiden."

Der Satz stimmt — deshalb ist diesmal BEIDES geändert:
findSameDayAcquisition() sieht den Zustand jetzt an, und damit gilt die
feinere Regel überall. Ohne diesen zweiten Schritt entstünde genau der
Widerspruch, den der Abschnitt „Warum an einer Stelle" weiter unten als
Altlast beschreibt: ein Anlege-Pfad, der einen Zustand herstellt, den der
Bearbeiten-Pfad ablehnt.

GEMESSEN vorher, eine Wanted-Liste mit zweimal 3001 in Rot (3 Stück NEU zu
1.50 und 2 Stück GEBRAUCHT zu 0.50): EINE Zeile, quantity 5, unit_price
1.10, condition 'U'. Der Mischpreis, und die drei neuen Teile als gebraucht
verbucht.

── Was beim Aufstocken aus Zustand und Preis wird ──────────────────────────
Zusammengefasst wird nur noch, was denselben Zustand hat — der Zustand der
Zeile ändert sich dabei also nicht mehr. Die Regel „gebraucht gewinnt" gilt
weiterhin für die ANSICHT eines Eintrags (conditionFromAcquisitions in
utils/handlers.ts: eine U-Erfassung macht den Eintrag gebraucht); sie gehört
dorthin und nicht in die Erfassung, die festhält, was wirklich gekauft
wurde.

Preis: mengengewichtet gemittelt, wenn beide einen haben — dieselbe
Rechnung, mit der die Zeilen später ohnehin verdichtet werden
(utils/setValue.ts). Hat nur einer einen Preis, gilt dieser; hat keiner
einen, bleibt die Zeile ohne Preis.

── Warum an einer Stelle ───────────────────────────────────────────────────
Die Regel wurde bisher an drei Orten halb umgesetzt: die Mengenänderung im
Set-Dialog fasste am selben Tag zusammen, die Datumsänderung wies einen
zweiten Eintrag am selben Tag ab — und die Anlege-Pfade schrieben munter
eine zweite Zeile. Der Anlege-Pfad konnte damit einen Zustand herstellen,
den der Bearbeiten-Pfad ablehnt.
```

<a id="recordacquisitionforday"></a>
## `recordAcquisitionForDay`

```text
Erfassung anlegen — oder die des Tages im selben Zustand aufstocken.

@param kind      'set' | 'part' | 'fig'
@param userId
@param keyValues Schlüsselwerte in der Reihenfolge von SHAPES[kind].keys
                 (Set: [setNumber]; Teil: [partNumber, colorId]; Figur: [figNumber])
@param input     Menge, Preis, Zustand, Tag
@param dbh       Transaktions-Handle, falls der Aufrufer eines hat
@returns { merged } — true, wenn eine bestehende Zeile aufgestockt wurde
```

<a id="recordacquisitionforday-existing"></a>
## `existing`

```text
Bestehende Zeile dieses Tages IM SELBEN ZUSTAND.

Der Zustand steht seit dem 21.10. in der Bedingung (Marcos Befund, siehe
Modulkopf) und seit Migration 0040 auch im Unique-Index. COALESCE auf
beiden Seiten: Die Spalte ist nullbar, und NULL ist in SQL nie gleich
NULL — ohne das fände diese Abfrage eine Zeile ohne Zustand nie wieder.
`cond` oben ist bereits auf 'N'/'U' festgelegt.

Der Tag wird in UTC bestimmt, nicht in der Zeitzone der Sitzung. Grund:
Nur so lässt sich die Regel als Unique-Index festnageln (siehe
db/migrations/0008) — `created_at::date` hängt an der Sitzungszone und ist
damit nicht indizierbar. Der Server läuft in UTC (Etc/UTC im Container),
für die Installation ändert sich dadurch nichts.
```

<a id="findsamedayacquisition"></a>
## `findSameDayAcquisition`

```text
Gibt es für diesen Tag und Zustand schon eine Erfassung — ausser der
angegebenen?

Für die Bearbeiten-Pfade: Wer das Kaufdatum einer Erfassung auf einen Tag
setzt, an dem bereits eine liegt, würde die Regel brechen. Die drei Routen
(Sets, Teile, Minifiguren) hatten dafür je eine eigene, wortgleiche Abfrage
— drei Kopien derselben Regel, von denen jede einzeln hätte veralten können.

── `condition` seit dem 21.10. ─────────────────────────────────────────────

Das ist der zweite Schritt zu Marcos Befund (siehe Modulkopf). Ohne ihn
wiese dieser Prüfer ab, was recordAcquisitionForDay() gerade anlegen darf:
zwei Zeilen desselben Tages mit verschiedenem Zustand. Genau diesen
Widerspruch — Anlege-Pfad erlaubt, Bearbeiten-Pfad verbietet — beschreibt
der Abschnitt „Warum an einer Stelle" als die Altlast, aus der dieser Helfer
entstanden ist.

Fehlt `condition`, gilt der Vorgabewert 'N' — derselbe, unter dem
recordAcquisitionForDay() eine Zeile ohne Zustand findet, und derselbe, den
der Unique-Index aus Migration 0040 einsetzt.

@param excludeId die Erfassung, die gerade bearbeitet wird
@param condition der Zustand, den die Zeile NACH der Bearbeitung hat
@returns die kollidierende id, oder null
```

<a id="acquisitiontotals"></a>
## `acquisitionTotals`

```text
Summenzeile einer Erfassungsliste: Stückzahl und Gesamtbetrag.

── Warum das der Server rechnet ────────────────────────────────────────────
Diese Summe stand bisher VIERMAL in den Oberflächen: zweimal in der Webapp
(Set-Dialog und Dialog für manuelle Einträge, `07-admin.js`) und zweimal in
der App (`AcquisitionManagementScreen`, `ManualItemComposables`). Vier
Fassungen derselben Rechnung — und sie waren sich nicht einmal einig, aus
welchem Feld der Preis kommt: Die Webapp las je nach Dialog fest
`purchase_price` ODER fest `unit_price`, die App hatte dafür eine
Rückfallregel (`purchasePrice ?: unitPrice`), die es in der Webapp gar nicht
gibt. Dass die Zahlen heute übereinstimmen, liegt allein daran, dass die
Abfragen je Art nur EINES der beiden Felder füllen. Kommt einmal beides mit,
zeigen die zwei Clients Verschiedenes.

Jetzt liegt die Regel hier, die Antwort trägt sie mit, und die Oberflächen
zeigen sie nur noch an.

── Die Regel ───────────────────────────────────────────────────────────────
Menge: Summe über alle Zeilen — auch über die ohne Preis, denn die Stücke
sind da.
Betrag: Summe aus Preis × Menge über die Zeilen, DIE EINEN PREIS HABEN.
Gibt es keine einzige davon, ist der Betrag `null` und nicht 0: „nichts
erfasst" ist etwas anderes als „für null Franken gekauft", und nur mit
`null` kann die Oberfläche den Gedankenstrich zeigen, ohne selbst zu raten.

@param rows Zeilen aus einer der drei Erfassungstabellen
@returns {{quantity:number, amount:number|null, priced_rows:number}}
```
