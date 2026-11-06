# Begründungen zu `test/set-quantity-household-db.test.js`

Die ausführlichen Kommentare aus `test/set-quantity-household-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Anzahl zeigt den HAUSHALT — geändert wird das EIGENE Konto.

── Marcos Vorgabe ──────────────────────────────────────────────────────────
„Die Anzahl soll immer von allen angezeigt werden. Wenn ich diese erhöhe,
soll es für meinen Account einen neuen Kaufpreis-Eintrag erstellen. Analog
der bestehenden Logik. Jeweils die Logik im Server implementieren."

── Was vorher war ──────────────────────────────────────────────────────────
Zwei Stellen, die sich widersprachen:

  • Das DETAIL las `SELECT * FROM sets WHERE user_id = ANY(blickfeld)` und
    nahm irgendeine Zeile — welche, entschied die Reihenfolge in der
    Tabelle. Marco sah „Anzahl 0" für ein Set, von dem das Unterkonto ein
    Exemplar hält. Die LISTE summierte längst; nur das Detail nicht.
  • Die ÄNDERUNG schrieb auf den Besitzer eben dieser Zeile. Ein „+" auf
    einem Set des Unterkontos erhöhte dessen Bestand, und die neue Erfassung
    entstand in einem fremden Konto.

── Die Regel ───────────────────────────────────────────────────────────────
Angezeigt wird die Summe über das Blickfeld. Gesendet wird eine
Gesamtmenge; geschrieben wird die DIFFERENZ, und zwar auf das eigene Konto.
Nach unten bei den eigenen Exemplaren gedeckelt — fremde lassen sich nicht
wegnehmen. Die Antwort trägt die tatsächliche Gesamtmenge zurück.

„Analog der bestehenden Logik" heisst wörtlich dieselbe Funktion:
adjustAcquisitionsToQuantity() legt die Erfassung an, holt den Marktpreis
und beachtet die Tagesregel — unverändert, nur mit anderem Ziel.
```
