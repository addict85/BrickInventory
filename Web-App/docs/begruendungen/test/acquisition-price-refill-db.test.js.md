# Begründungen zu `test/acquisition-price-refill-db.test.js`

Die ausführlichen Kommentare aus `test/acquisition-price-refill-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Kaufpreis LÖSCHEN → Marktpreis nachfüllen, auf beiden Wegen.

── Woher dieser Test kommt (Marcos Bericht, Nachtrag 68) ───────────────────
„Wenn ich bei einem bestehenden Set die Anzahl erhöhe und dann den Kaufpreis
lösche (bei einem anderen Besitzer), wird der aktuelle Preis nicht von
BrickLink abgefüllt." Auf seinem Screenshot stand in der Kaufpreis-Kachel
nur ein Strich, obwohl der Marktpreis (12.55 CHF) bekannt war.

Ursache: In der Konfiguration der v1-Erfassungsrouten stand für SETS
`resolvePrice: null` — als einzige der drei Elementarten. Teile und
Minifiguren holen den Marktpreis seit jeher, und die Webapp-Route tut es für
Sets ebenfalls. Nur der Android-Weg liess das Feld leer. Weil die Kachel aus
`sets.purchase_price` las und die Spiegelung den leeren Wert übernahm, stand
danach in der ganzen App ein Strich. (Die Spalte ist seit Migration 0032
weg; die Kachel rechnet jetzt aus den Erfassungen — eine leere Erfassung
ergibt dort genauso einen Strich, der Fall bleibt also derselbe.)

Wieder das Muster „dieselbe Regel fehlt am zweiten Weg" — dieselbe Zeile in
derselben Konfiguration wie schon bei `parentPriceSql` (Nachtrag 51).

ZUSTAND ZÄHLT: Ein „Neu"-Eintrag muss den Neu-Preis bekommen, nicht den der
Gebraucht-Erfassung daneben. Genau diese Verwechslung prüft der Test mit —
im Cache stehen bewusst zwei verschiedene Preise.
```

<a id="stelle"></a>
## `await db.run('INSERT INTO global_settings (key,value) VALUES ('currenc`

```text
Marcos Befund (Nachtrag 69): Android füllte 12.55, die Webapp 18.90 — für
DENSELBEN Vorgang. Ursache war eine zweite, eigene Preisregel im
Webapp-Weg, die die GLOBALE Währung las statt der des Kontos. Deshalb
steht hier bewusst eine abweichende globale Währung mit anderen Preisen:
Läuft irgendwann wieder eine zweite Fassung mit, fallen die beiden Wege
sofort auseinander und dieser Test wird rot.
```
