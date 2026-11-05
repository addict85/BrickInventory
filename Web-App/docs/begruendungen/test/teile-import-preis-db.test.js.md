# Begründungen zu `test/teile-import-preis-db.test.js`

Die ausführlichen Kommentare aus `test/teile-import-preis-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
CSV-Import und Erfassen von Hand müssen dasselbe hinterlassen.

── Der Befund ──────────────────────────────────────────────────────────────
Bei den Minifiguren steht die Rechnung „Preis/Stk, Kaufpreis, Zustand"
EINMAL (resolveManualFigPurchase) und hat drei Aufrufer. Bei den Teilen
stand sie an jeder Stelle neu — und die Fassungen im Anlegen und im
CSV-Import sagten zweierlei:

 1. `unit_price` bekam beim Import den MARKTPREIS. Das Feld heisst
    „Preis/Stk" und bedeutet „was der Mensch bezahlt hat"; ohne Angabe in
    der Datei gehört dort NULL hin. jobs/purchasePriceBackfill.ts liest
    unit_price ausdrücklich als „wurde beim Erfassen eingegeben" — ein
    importiertes Teil behauptete eine Eingabe, die es nie gab.

 2. Ohne Marktpreis schrieb der Import NULL in den Kaufpreis. Beim Anlegen
    von Hand wird dort bewusst 0 gespeichert, sonst zeigt das Feld im
    Frontend dauerhaft den „Marktpreis"-Platzhalter.

── Warum gegen die echte Route ─────────────────────────────────────────────
Am Quelltext wäre es die Frage, ob zweimal dieselbe Variable im INSERT
steht. Interessant ist aber, was am Ende IN DER TABELLE liegt — und zwar
verglichen mit dem anderen Weg zum selben Ziel. Deshalb läuft hier der
echte Import über eine echte Datei gegen eine echte Datenbank, und daneben
derselbe Fall von Hand.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="spalten"></a>
## `const spalten = 'unit_price, condition, quantity';`

```text
── Gelesen aus der ERFASSUNG ─────────────────────────────────────────

Preis und Zustand standen hier auf der Teile-Zeile. Migration 0035 hat
sie geloescht: Sie gehoeren je Kauf in part_acquisitions. Die Frage
dieses Tests bleibt dieselbe — hinterlassen CSV-Import und Erfassen von
Hand denselben Zustand? — nur dass sie jetzt dort gestellt wird, wo die
Antwort liegt.
```
