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
