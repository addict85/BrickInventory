# Begründungen zu `test/set-quantity-scope-db.test.js`

Die ausführlichen Kommentare aus `test/set-quantity-scope-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Menge eines UNTERKONTO-Sets ändern — beide Routenfamilien.

── Woher dieser Test kommt (Marcos Bericht, Nachtrag 52) ───────────────────
„Wenn die Anzahl eines Sets erhöht wird, welches einem Unterkonto gehört,
funktioniert die ganze Logik nicht mit dem Kaufpreis und die Anzahl wird
nicht gespeichert."

Ursache: `updateSet()` suchte das Set mit `WHERE user_id=$1` und der EIGENEN
Betrachter-ID — 404 für jedes Set des Unterkontos. Beim Nachmessen zeigte
sich, dass es BEIDE Wege trifft, auch die Webapp, die Marco noch nicht
getestet hatte.

Dieselbe Klasse wie Nachtrag 45 (dort der Kaufpreis, hier die Menge) — und
weil die Mengenänderung über adjustAcquisitionsToQuantity() auch Erfassungen
anlegt und Preise bestimmt, blieb gleich die ganze Kette wirkungslos. Genau
das beschreibt Marcos Satz „die ganze Logik mit dem Kaufpreis".

Nach dem Finden zählt der BESITZER der Zeile, nicht der Betrachter — sonst
entstünden die Erfassungen im falschen Konto. Das prüft der Test mit.
```

<a id="beimbesitzer"></a>
## `const beimBesitzer = await mengeVon(db, subId, SN);`

```text
(Die Mengen kommen jetzt alle aus den Erfassungen — Migration 0036.)
── Marcos neue Regel (Nachtrag 85) ────────────────────────────────
„Die Anzahl soll immer von allen angezeigt werden. Wenn ich diese
erhöhe, soll es für meinen Account einen neuen Kaufpreis-Eintrag
erstellen."

Bis Nachtrag 52 endete das hier in einem 404 — das bleibt geprüft.
Bis Nachtrag 84 landete die Erhöhung dann beim BESITZER der Zeile, und
dieser Test verlangte ausdrücklich, dass im Konto des Betrachters
KEINE Erfassung entsteht. Genau das ist jetzt umgekehrt: Die
angezeigte 3 ist die Gesamtmenge des Haushalts, die Differenz gehört
dem, der sie auslöst.
```
