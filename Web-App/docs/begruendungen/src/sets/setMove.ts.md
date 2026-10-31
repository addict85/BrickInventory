# Begründungen zu `src/sets/setMove.ts`

Die ausführlichen Kommentare aus `src/sets/setMove.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Ein Set (oder einzelne Kaufpreise davon) in ein anderes Konto des Haushalts
verschieben.

── Warum das nicht nur ein UPDATE der user_id ist ──────────────────────────

1. ERFASSUNGEN. Es gilt „pro Tag, Element und Benutzer genau EIN Kaufpreis"
   (src/bestand/acquisitions.ts). Ein direktes Umhängen könnte im Zielkonto zwei
   Zeilen desselben Tages hinterlassen — genau den Zustand, den der
   Bearbeiten-Pfad ablehnt. Deshalb wandern sie einzeln durch
   recordAcquisitionForDay(), das bei Bedarf mengengewichtet zusammenfasst.

2. TEILE UND MINIFIGUREN hängen an (Konto, Setnummer) — NICHT am einzelnen
   Exemplar. `parts.quantity` ist die Menge für EIN Set; die Gesamtmenge
   entsteht erst durch Multiplikation mit `sets.quantity`
   (siehe src/teile/partsSummary.ts).

   Daraus folgt für eine TEILVERSCHIEBUNG: Das Zielkonto braucht eine
   KOPIE der Zeilen, keine Verschiebung — die Quelle behält ja Exemplare
   und damit auch deren Teile. Erst wenn dort das letzte Exemplar geht,
   verschwinden Set und Inhalt beim Absender.

   Ein blosses Umhängen (wie es die erste Fassung tat) wäre für den
   Teilfall falsch gewesen: Die Quelle hätte Exemplare ohne Teile behalten.

3. ANLEITUNGEN hängen ebenfalls an (Konto, Setnummer). Die Galerie zeigt sie
   nur zu Sets, die das Konto besitzt — eine zurückgebliebene Zeile wäre
   unsichtbar, während die Datei auf der Platte liegt. Auch sie werden
   kopiert bzw. beim letzten Exemplar mitgenommen.
```

<a id="copycontents"></a>
## `copyContents`

```text
Inhaltszeilen ins Zielkonto spiegeln, sofern dort noch keine liegen.

Geprüft wird JE TABELLE, ob das Zielkonto für dieses Set schon Zeilen hat —
nicht, ob es das Set hat. Der Unterschied ist nicht theoretisch: Ein Set
kann durchaus ohne Teile im Bestand stehen (Erfassung ohne Teile-Import,
abgebrochener Import, ein zuvor bewusst geleerter Bestand). Wer vom Set auf
die Teile schliesst, kopiert dann nichts — und löscht anschliessend beim
Absender, wenn dort das letzte Exemplar geht. Die Teile wären weg.

Umgekehrt darf nicht doppelt kopiert werden: Die Menge steckt in
sets.quantity, nicht in der Zahl der Zeilen; doppelte Zeilen zählte die
Zusammenfassung zweimal.
```

<a id="copycontents-hasparts"></a>
## `hasParts`

```text
NACHEINANDER, nicht per Promise.all.

`tx` ist EINE Verbindung. Drei gleichzeitige Abfragen darauf sind kein
Parallelbetrieb, sondern ein Fehler: pg warnt mit „Calling client.query()
when the client is already executing a query is deprecated and will be
removed in pg@9.0" — genau diese Meldung stand im Serverprotokoll beim
Verschieben eines Sets. Ab pg 9 wäre es kein Warnhinweis mehr, und in
einer Transaktion ist verschachteltes Abfragen ohnehin heikel: Die
Reihenfolge von BEGIN, Abfrage und COMMIT auf derselben Verbindung ist
dann nicht mehr die, die hier im Code steht.

Zeitlich kostet es nichts — drei Indexzugriffe auf LIMIT 1.
```

<a id="copycontents-m"></a>
## `m`

```text
── Was hier einmal schiefging, kann jetzt nicht mehr schiefgehen ───────

Vorher nahmen die Teile 14 Spalten mit und die Figuren 7 — und das war
kein Stilunterschied: image_local fehlte im Figurenzweig. Ein verschobenes
Set verlor im Zielkonto die zwischengespeicherten Figuren-Bilder, die
Teile behielten ihre. Bis zum naechsten Durchlauf des Bild-Jobs (der nur
beim Serverstart laeuft) kam jedes Bild wieder ueber den Proxy vom CDN.

Mit Migration 0034 steht das Bild im Katalog und nicht an der Zeile. Es
gibt nichts mitzunehmen, also auch nichts zu vergessen — die Fehlerquelle
ist weg, nicht nur der Fehler.
```

<a id="movesetbetweenaccounts-src"></a>
## `src`

```text
Spalten ausgeschrieben, kein SELECT *: Ein Stern verliert stillschweigend
eine geloeschte Spalte und gewinnt stillschweigend eine neue. Beides ist
in diesem Baum schon passiert — der Lagerort verschwand so aus der
Set-Detailansicht (handlers/sets.ts).

Die Menge kommt nicht mehr von hier: Migration 0036 hat die Spalte
geloescht, sie wird aus den Erfassungen gerechnet (db/bestandsmenge.ts).
Hier sind die Erfassungen gleich darunter ohnehin zur Hand — die Summe
steht in `all`.
```

<a id="movesetbetweenaccounts"></a>
## Abschnitt

```text
Stammdaten mitnehmen (Name, Jahr, Bild …) — sie beschreiben das Set,
nicht das Exemplar, und ein erneuter Katalogabruf wäre unnötig.
── Was hier NICHT mehr mitwandert ────────────────────────────────────

Kaufpreis und Zustand: Sie wandern mit den Erfassungen eine Schleife
weiter unten; die sets-Zeile hat die Spalten seit Migration 0032 nicht
mehr. Vorher wurden sie an beiden Stellen übertragen — mit dem Risiko,
dass die kopierte Spalte und die kopierten Erfassungen beim
Teilverschieben auseinanderliefen.

Die Stammdaten („Name, Jahr, Bild … sie beschreiben das Set, nicht das
Exemplar, und ein erneuter Katalogabruf wäre unnötig") stehen seit
Migration 0033 im Katalog. Hier gab es nie etwas zu holen: Die Setnummer
bleibt dieselbe, also ist es dieselbe Katalogzeile. Der Satz war richtig
und die Abschrift trotzdem unnötig.

`added_at` wandert weiter mit: Es beschreibt, seit wann DIESER Bestand
da ist, nicht das Set.
Ohne Menge: Sie steht in den Erfassungen, die gleich darunter wandern.
```

<a id="movesetbetweenaccounts-2"></a>
## Abschnitt

```text
── TEILVERSCHIEBUNG: alles steht danach in BEIDEN Konten ──────────────

Wird einer von mehreren Kaufpreisen umgehängt, behält der Absender
Exemplare. Set, Teile, Minifiguren und Anleitungen bleiben deshalb bei
ihm — beim Ziel liegen inzwischen Kopien (copyContents oben), und die
Stückzahl hier sinkt nur um die gewanderten Exemplare.

Ein Exemplar ohne Teile wäre ein halber Bestand: Die Teileliste des
Absenders verlöre die Zeilen, obwohl er das Set noch besitzt.

Die Stueckzahl des Absenders ist oben schon aus seinen Erfassungen
gerechnet; hier stand dafuer `UPDATE sets SET quantity=$1` mit dem von
Hand ausgerechneten Rest.
```

<a id="movemanualacquisition"></a>
## `moveManualAcquisition`

```text
Wie beim Set: Verschoben wird über den KAUFPREIS, nicht über den Eintrag.

── Warum das hier einfacher ist als bei Sets ───────────────────────────────
Ein manuell erfasstes Teil hat keinen Inhalt: keine Unterteile, keine
Minifiguren, keine Anleitungen. Es wandern also nur die Menge und die
Erfassung selbst. Der Rest ist dieselbe Regel wie oben — die Erfassung geht
durch recordAcquisitionForDay(), damit im Zielkonto nicht zwei Zeilen
desselben Tages entstehen.

── Was der Absender behält ─────────────────────────────────────────────────
Bleiben ihm Exemplare, sinkt nur die Stückzahl. Geht das letzte, verschwindet
die Stammzeile bei ihm — bei einem manuell erfassten Eintrag ist eine Zeile
mit Menge 0 kein Bestand, sondern Ballast.
```

<a id="movemanualacquisition-gesamt"></a>
## `gesamt`

```text
── Wieviel bleibt: aus den ERFASSUNGEN, nicht von der Zeile ────────────

Hier stand `(src.quantity || 1) - movingQty`. Die Spalte gibt es seit
Migration 0038 nicht mehr, `src.quantity` war also `undefined` — und weil
movingQty mindestens 1 ist, war `remaining` IMMER 0. Jedes Verschieben
einer einzelnen Erfassung loeschte damit unten ALLE Erfassungen des
Absenders fuer diese Position und seine Bestandszeile dazu, auch wenn er
zehn hatte. Ohne Fehlermeldung.

Der Set-Zweig daneben (moveSetAcquisition) rechnet genau so, und dort
steht sogar der Kommentar, dass dieser Rueckfall entfernt wurde — im
manuellen Zweig blieb er stehen. Gemessen an
test/erfassung-verschieben-rest-bleibt-db.test.js: „Der Absender hat 0
Erfassungen uebrig, erwartet 1 mit Menge 3".
```

<a id="movemanualacquisition-2"></a>
## Abschnitt

```text
── Nur noch Menge und Nummer ───────────────────────────────────────

Die Beschreibung — Name, Farbe, Bild — stand hier einmal mit in der
Spaltenliste. Sie beschreibt das Teil und nicht das Exemplar und liegt
seit Migration 0034 im Katalog; sie ist also schon da, denn das Teil
existiert im Absenderkonto und damit im Katalog.

Preis und Zustand sind mit Migration 0035 gefolgt: Sie reisen in der
ERFASSUNG mit, und die legt recordAcquisitionForDay() gleich darunter
an — mit acq.unit_price und acq.condition, also den Werten DER
verschobenen Erfassung. Sie hier noch einmal mitzunehmen hiesse, den
Wert der NEUESTEN Erfassung des Absenders zu kopieren; das war schon
vorher eine andere Zahl als die verschobene.
```
