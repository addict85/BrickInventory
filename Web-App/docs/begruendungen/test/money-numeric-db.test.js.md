# Begründungen zu `test/money-numeric-db.test.js`

Die ausführlichen Kommentare aus `test/money-numeric-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Geldbeträge: exakt statt „fast".

── Was hier geprüft wird ───────────────────────────────────────────────────
Alle Preisspalten lagen als REAL (32-Bit-Gleitkomma) in der Datenbank. Das
war am laufenden Server sichtbar — ein Kaufpreis von 49.90 kam als
49.9000015258789 zurück — und beim Summieren wuchs der Fehler mit der Zahl
der Beträge.

Geprüft wird deshalb dreierlei, alles gegen echtes Postgres:
  1. Keine Geldspalte ist mehr REAL — weder bei einer Neuinstallation
     (initSchema) noch nach der Migration einer alten Datenbank.
  2. Die Summe stimmt auf den Rappen, auch über tausend Beträge.
  3. Was der Server ausliefert, hat keine Gleitkomma-Schwänze mehr.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
Ohne DB: skip.
```

<a id="geldspalten"></a>
## `const GELDSPALTEN = '`

```text
Alle Spalten, die Geld führen.

Bis zu den Gutscheinen hiess das: Name endet auf `_price`. `vouchers.amount`
führt aber genauso Geld und wäre durch dieses Netz gefallen — eine neue
Geldspalte wäre damit ungeprüft als REAL anlegbar gewesen, und genau davor
schützt dieser Test.

Deshalb steht `amount` jetzt daneben. GEMESSEN beim Hinzufügen: Vor den
Gutscheinen gab es im ganzen Schema keine einzige Spalte mit „amount" im
Namen, das Muster fängt also nichts Fremdes ein.
```

<a id="for-stelle"></a>
## `for (const [tab, sp] of [`

```text
Alte Installation nachstellen: Spalte zurück auf REAL, Migration erneut
laufen lassen (Vermerk in schema_migrations entfernen).

── Alle Spalten zurueckholen, die 0007 anfasst ───────────────────────

Migration 0007 stellt fuenfzehn Geldspalten auf NUMERIC um. Spaetere
Migrationen loeschen einige davon wieder, weil der Wert an einen anderen
Ort gehoert:

  0032  sets.purchase_price
  0035  parts.unit_price, parts.purchase_price,
        minifigs.unit_price, minifigs.purchase_price

Eine alte Datenbank, die 0007 noch vor sich hat, HAT sie alle. Fehlt
eine, scheitert der erneute Lauf mit „column … does not exist" und
prueft nichts mehr — GEMESSEN zuerst mit sets.purchase_price (0032) und
dann erneut mit parts.purchase_price (0035).

Und es trifft nicht nur diese Datei: Der Vermerk fuer 0007 wird unten
geloescht und erst vom erfolgreichen Lauf wieder gesetzt. Scheitert er,
laeuft 0007 in JEDER spaeteren Testdatei erneut und scheitert dort auch
— GEMESSEN an test/part-price-keys-db.test.js, das daran mit einem
Zeitueberschreitung abbrach.
```

<a id="for-stelle-2"></a>
## `for (const [tab, sp] of [`

```text
── Und den Endzustand wiederherstellen ───────────────────────────────

Die fuenf Spalten oben sind absichtlich zurueckgeholt worden, damit 0007
erneut laufen KANN. Die Migrationen, die sie loeschen, gelten als
angewandt und raeumen sie nicht noch einmal weg — ohne diese Zeilen
bliebe die gemeinsame Test-Datenbank in einem Zustand, den keine
Installation hat, fuer alle Dateien danach.
```
