# Begründungen zu `test/manual-acq-refresh.test.js`

Die ausführlichen Kommentare aus `test/manual-acq-refresh.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Erfassungsliste im Detail-Dialog manueller Teile und Minifiguren.

── Zwei gemeldete Fehlerbilder, eine Ursache ───────────────────────────────
  1. Teil, Menge ERHÖHEN, noch keine Erfassung für heute → es erschien keine
     neue Zeile in der Detail-Ansicht.
  2. Minifigur, Menge REDUZIEREN → der heutige Kaufpreis-Eintrag verschwand
     nicht aus der Detail-Ansicht.

Beide kamen aus `if (qty > prevQty)` in manQtySave(): Die Erfassungsliste
wurde nur beim Erhöhen nachgeladen — und `prevQty` war unzuverlässig, weil es
bei Teilen nur über part_number gesucht wurde (ohne color_id) und im
Fehlerfall auf den bereits gesetzten NEUEN Wert zurückfiel.

Der Server war in beiden Fällen korrekt; falsch war nur die Anzeige.
```

<a id="stelle"></a>
## `assert.match(strip(acq), /WHERE[\s\S]{0,400}AND condition = \$/,`

```text
── Schlüssel: Benutzer + Eintrag + Tag + ZUSTAND (seit dem 21.10.) ───────

Hier stand das Gegenteil, und zwar als ausdrückliche Zusicherung: „Der
Zustand darf NICHT im Schlüssel stehen", begründet damit, dass die
Datums-Endpunkte einen zweiten Eintrag am selben Tag ohnehin ohne Blick
auf den Zustand abweisen.

Marcos Befund vom 21.10.: „wenn das Teil und Farbe bereits existiert und
nur der Zustand anders ist, einen neuen Preis erzeugen mit einem anderen
Zustand." GEMESSEN vorher, eine Wanted-Liste mit 3 Stück NEU zu 1.50 und
2 Stück GEBRAUCHT zu 0.50 desselben Teils: EINE Zeile, quantity 5,
unit_price 1.10, condition 'U'. Der Mischpreis, und die neuen Teile als
gebraucht verbucht.

Die alte Begründung war gut und gilt weiter — deshalb ist BEIDES
geändert: Der Datums-Endpunkt sieht den Zustand jetzt ebenfalls an (der
Fall darunter prüft das). Die Zusicherung dreht sich damit um, statt zu
verschwinden: Die neue Regel verdient dieselbe Wachsamkeit wie die alte.
```

<a id="stelle-2"></a>
## `assert.doesNotMatch(strip(acq), /existing\.condition === 'U' \|\| cond`

```text
…und ihren EIGENEN Zustand: Gefunden wird die Zeile genau über ihn, also
gibt es beim Aufstocken nichts mehr zu verschmelzen. Hier stand
`existing.condition === 'U' || cond === 'U'` — „gebraucht gewinnt" —, und
das war die Stelle, an der ein neuer Kauf einen gebrauchten mitnahm.

Für die ANSICHT eines Eintrags gilt die Regel weiter
(conditionFromAcquisitions in utils/handlers.ts); sie gehört dorthin und
nicht in die Erfassung, die festhält, was wirklich gekauft wurde.
```

<a id="fab-stelle"></a>
## `const fab = read('src/sammlung/erfassungen.ts');`

```text
Alle drei Datums-Endpunkte benutzen denselben Prüfer — die Abfrage stand
vorher dreimal wortgleich in den Routen. Anlegen und Bearbeiten müssen
dieselbe Regel haben, sonst erzeugt der eine Pfad, was der andere ablehnt.
Seit Nachtrag 70 steht die Kollisionsprüfung des BEARBEITEN-Pfads in der
gemeinsamen Fabrik (sie bedient Webapp und App); das ANLEGEN liegt weiter
in den Session-Routen. Geprüft wird deshalb: Beide Orte rufen denselben
Helfer, und keiner hält eine eigene Kopie der Tagesregel.
Die Fabrik bedient alle drei Elementarten mit EINEM Aufruf und gibt die Art
aus der Konfiguration mit (cfg.kind) — deshalb steht hier kein wörtliches
findSameDayAcquisition('set', … mehr. Geprüft wird die Regel, nicht die
Schreibweise: Der gemeinsame Helfer wird gerufen, und jede Elementart ist
in der Konfiguration hinterlegt.
```

<a id="src-stelle"></a>
## `const src = require('./helpers/sources').setKernQuelle();`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
updateSet() setzte sets.quantity und rief danach
adjustAcquisitionsToQuantity(…).catch(() => {}) — zwei lose Statements,
ohne Transaktion, ohne Sperre, mit verschlucktem Fehler. Scheiterte der
zweite Schritt, blieb die Menge erhöht, während die Erfassungen auf dem
alten Stand standen: genau der Drift, gegen den es db/txLock.ts gibt,
nur ohne jede Logzeile. Alle anderen Schreibwege am Bestand
(Kaufpreis-Routen in sets/parts/minifigs, die v1-Fabrik) laufen längst
unter dem Advisory-Lock.
```

<a id="stelle-3"></a>
## `assert.match(fn, /repo\.setMenge\(dbh, 'blickfeld', leseFeld/,`

```text
Und die Differenz muss aus der GESAMTMENGE des Blickfelds kommen, nicht
aus der Zeile eines einzelnen Kontos — sonst zeigte das Detail eine
Haushaltszahl an, während das „+" gegen eine andere rechnete.
Die Abfrage steht seit Migration 0036 in db/bestandsmenge.ts; hier
stand sie ausgeschrieben. Was sie daraus macht, prueft
test/quantity-response-echo.test.js — diese Stelle prueft, dass der
Aufruf das BLICKFELD nennt und nicht ein einzelnes Konto.
```

<a id="stellen"></a>
## `const stellen = [`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
Alle vier Löschrouten (Session und /api/v1, Teile und Minifiguren)
löschten die Erfassungshistorie mit `.catch(() => {})`. Verschluckt hiess:
Die Stammzeile ist weg, die Erfassungen bleiben — und Finanzsummen und
Portfoliokurve lesen die ERFASSUNGEN. Ein gelöschtes Teil hätte dort
dauerhaft weitergezählt, und zwar unsichtbar: Keine Ansicht zeigt
verwaiste Erfassungen, es fällt nur als „die Summe stimmt nicht" auf.
```

<a id="tabellen"></a>
## `const TABELLEN = ['sets', 'parts', 'minifigs', 'set_acquisitions',`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
Ein leerer Catch sagt zwei Dinge gleichzeitig: „darf scheitern" und
„niemand erfährt davon". Das erste ist oft richtig, das zweite fast nie —
eine Spiegelung, die seit Wochen jedes Mal scheitert, sieht von aussen
identisch aus wie eine, die funktioniert.

Für Schreibvorgänge auf den BESTANDSTABELLEN gilt deshalb: entweder den
Fehler durchreichen (Pflichtschritt) oder logAndContinue() aus
src/infra/fehler.ts (bewusst optionaler Schritt). Ein leerer Catch ist
keine der beiden Möglichkeiten. Anderswo — Bild-Caches, Aufräumen,
Fremd-APIs — bleibt er erlaubt; dieser Test greift nur die Tabellen ab,
aus denen Bestand und Finanzsummen gelesen werden.
```
