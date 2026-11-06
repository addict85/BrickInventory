# Begründungen zu `test/teile-preis-schluessel-db.test.js`

Die ausführlichen Kommentare aus `test/teile-preis-schluessel-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Teile-Preis-Cache hat EINEN Schlüsselraum.

── Der Befund ──────────────────────────────────────────────────────────────
fetchPartPrice() übersetzte nur die FARBE nach BrickLink; die Teilenummer
nahm es so, wie der Aufrufer sie mitbrachte. Und die drei Aufrufer bringen
Verschiedenes mit:

  src/finanzen/financeCalc.ts:878   part.bl_part_number || part.part_number → BL
  routes/parts.ts:224        partNumber                              → RB
  routes/minifigs.ts:203     blPartNum                               → BL

Für ein Teil, dessen Nummern sich unterscheiden, standen dadurch ZWEI Zeilen
für denselben Gegenstand in part_price_cache, jede mit eigener Frist: Die
Bewertung sah die Zeile nicht, die der Marktpreis der Teileansicht
geschrieben hatte, und umgekehrt — jede holte den Preis erneut bei
BrickLink. Und getPartPriceHistory suchte unter der BrickLink-Nummer, fand
also nur die Hälfte.

Der Kommentar in src/finanzen/priceHistory.ts behauptete den einen Schlüsselraum
bereits („werden unter der BRICKLINK-Teilenummer geschrieben"). Für die
Farbe stimmte er, für die Nummer nicht.

── Was geprüft wird ────────────────────────────────────────────────────────
 1. fetchPartPrice findet einen Cache-Eintrag, der unter der BrickLink-
    Nummer liegt, auch wenn es mit der Rebrickable-Nummer gerufen wird.
    Lesen und Schreiben benutzen dieselbe Variable — damit ist auch der
    Schreibschlüssel festgenagelt.
 2. getPartPriceHistory findet Preise unter BEIDEN Nummern. Die schon
    vorhandenen Zeilen unter der Rebrickable-Nummer sollen nicht aus dem
    Diagramm verschwinden.

Kein Netzzugriff: Der Cache-Treffer beendet fetchPartPrice, bevor BrickLink
gefragt würde.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="stelle"></a>
## `await haeltTeil(db, uid, RB2, { menge: 1, colorId: FARBE });`

```text
── 3. OHNE Zuordnung gilt die Rebrickable-Nummer ─────────────────────

Hier stand ein Fall, den es nicht mehr geben kann: Die BrickLink-Nummer
nur in parts.bl_part_number und nicht in rb_bl_mapping — der Zustand,
aus dem der Nachtrag-Job von selbst nie wieder herausfand. Mit Migration
0037 gibt es die zweite Quelle nicht, also auch nicht die Lücke zwischen
beiden (die Begründung steht in src/finanzen/rechnung/preise.ts).

Was stattdessen geprüft wird, ist der Fall, der BLEIBT: ein Teil ohne
jede Zuordnung. Dann muss der Cache unter der REBRICKABLE-Nummer
getroffen werden — und nicht unter einer erfundenen.
```
