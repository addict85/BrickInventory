# Begründungen zu `test/part-price-keys-db.test.js`

Die ausführlichen Kommentare aus `test/part-price-keys-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Marktpreis eines manuell erfassten Teils erreicht das Detailfenster.

── Marcos Befund (Nachtrag 143) ────────────────────────────────────────────
Auf der Finanzseite steht für „Primo Brick 1 x 1 (Blau)" CHF 0.13 als
Marktpreis. Im Detailfenster desselben Teils: „—".

── Zwei Schlüsselräume, die man nicht mischen darf ─────────────────────────
`part_price_cache` und `part_price_history` schreibt fetchPartPrice() — unter
der BRICKLINK-Teilenummer und der BRICKLINK-Farbnummer. BrickLink antwortet
auf Rebrickable-Nummern mit 404, deshalb wird vor dem Abruf übersetzt
(resolveBlPartNumber / resolveBlColorId), und der Cache erbt diesen Schlüssel.

`part_acquisitions` trägt dagegen die REBRICKABLE-Nummer — so hat der
Benutzer sie eingegeben.

getPartPriceHistory() nahm die Rebrickable-Werte für BEIDES. Für Teile ohne
Zuordnung stimmen die Schlüssel zufällig überein; für alle anderen fand die
Preisabfrage nichts, und die Zeile blieb leer.

Die Finanzseite war nie betroffen: computePartsValuation() übersetzt selbst.
```
