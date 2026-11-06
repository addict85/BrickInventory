# Begründungen zu `test/manuelle-marktpreise-db.test.js`

Die ausführlichen Kommentare aus `test/manuelle-marktpreise-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Manuell erfasste Teile und Figuren tragen ihren Marktpreis mit.

── Der Befund ──────────────────────────────────────────────────────────────

Marco: „Bei den manuell erfassten Minifiguren wird kein Marktpreis
angezeigt."

Der Detailbildschirm der App liest ihn aus `avg_price`
(ManualItemDetailScreen.kt: `fig?.avgPrice ?: part?.avgPrice`). Gefüllt wird
diese Liste aus /api/v1/minifigs/manual — einem `SELECT * FROM minifigs`.
Die Bestandszeile führt `unit_price` und `purchase_price`, aber KEINEN
Marktpreis; der liegt in minifig_price_cache. Das Feld war also immer leer.

Das ist die Folge einer früheren, richtigen Entscheidung: Die App holte
diese Listen einmal aus der BEWERTUNG und lud dabei jedes Mal alle
Marktpreis-Abfragen mit. Beim Umzug auf die schlanke Quelle ist übersehen
worden, dass der Detailbildschirm mehr zeigt als die Kachel.

── Was hier geprüft wird ───────────────────────────────────────────────────

Beide Richtungen, denn beide sind Regeln:

 1. Liegt ein Preis im Cache, steht er in der Liste — sonst ist der Befund
    nicht behoben.
 2. Liegt KEINER da, bleibt das Feld null und die Liste kommt trotzdem.
    Nur aus dem Cache zu lesen ist der Kern der Lösung: Ein Live-Abruf je
    Eintrag wäre genau der Zustand, von dem der Umzug wegführen sollte, und
    ginge auf das Tageskontingent bei BrickLink.

Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
Ausführen: REQUIRE_DB=1 npm test
```

<a id="stelle"></a>
## `await haeltFigur(db, U, FIG, { menge: 1 });`

```text
Der Zustand steht seit Migration 0035 in der Erfassung. Dieser Test
prueft den Marktpreis OHNE Erfassung, also bleibt es beim Vorgabewert
'N', den conditionFromAcquisitions() ohne Erfassungen liefert.
bl_fig_number ist mit Migration 0037 weg; dieselbe Nummer in beiden
Feldern hiess „keine abweichende", und das ist in der Zuordnung eine
leere bl_id. Hier braucht es dafuer gar keine Zeile.
```
