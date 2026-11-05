# Begründungen zu `test/erfassung-verschieben-rest-bleibt-db.test.js`

Die ausführlichen Kommentare aus `test/erfassung-verschieben-rest-bleibt-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine Erfassung verschieben nimmt nur SIE mit — nicht den ganzen Bestand.

── Woher dieser Test kommt ─────────────────────────────────────────────────

Aus einem Fehler, den Migration 0038 eingebaut hat. moveManualAcquisition()
entschied, ob die Zeile des Absenders stehenbleibt, so:

    const remaining = Math.max(0, (src.quantity || 1) - movingQty);
    …
    if (remaining > 0) return { …, source_emptied: false };
    await tx.run(`DELETE FROM ${acqTab} WHERE user_id = $1 AND ${keySql}`, …);
    await tx.run(`DELETE FROM ${table} WHERE id = $1`, [src.id]);

`src.quantity` gibt es seit 0038 nicht mehr. Der Ausdruck ist damit
`(undefined || 1) - movingQty`, und weil movingQty mindestens 1 ist, war
`remaining` IMMER 0: Jedes Verschieben einer einzelnen Erfassung loeschte
ALLE Erfassungen des Absenders fuer diese Position und seine Bestandszeile
dazu — auch wenn er zehn hatte. Ohne Fehlermeldung.

Der Set-Zweig daneben (moveSetAcquisition) rechnet es richtig: aus der
Summe der Erfassungen. Dort steht sogar der Kommentar, dass der Rueckfall
auf `src.quantity` entfernt wurde. Im manuellen Zweig blieb er stehen.

── Warum es keine Pruefung gefangen hat ────────────────────────────────────

Es gab eine: test/household.test.js prueft, dass der Endpunkt
moveManualAcquisition() RUFT — mit einem Mustervergleich auf dem Quelltext.
Das faengt eine geloeschte Zeile und sagt nichts darueber, was die Funktion
TUT. Dieser Test geht deshalb den Weg, den die Oberflaeche nimmt, und sieht
danach in die Datenbank.
```
