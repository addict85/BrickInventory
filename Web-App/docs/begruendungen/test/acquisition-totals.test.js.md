# Begründungen zu `test/acquisition-totals.test.js`

Die ausführlichen Kommentare aus `test/acquisition-totals.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Summenzeile der Erfassungen rechnet der SERVER — einmal.

── Woher dieser Test kommt (Marcos Frage) ──────────────────────────────────
„Kannst du sicherstellen, dass Berechnungen zentral in einer Komponente für
Webapp und Android-App durchgeführt werden, damit die GUIs nur das Rendering
übernehmen müssen?"

Die Summe unter einer Erfassungsliste stand VIERMAL in den Oberflächen:
zweimal in `public/js/07-admin.js` (Set-Dialog und Dialog für manuelle
Einträge) und zweimal in der App (`AcquisitionManagementScreen`,
`ManualItemComposables`). Und die vier waren sich nicht einig, aus welchem
Feld der Preis kommt: Die Webapp las je nach Dialog fest `purchase_price`
ODER fest `unit_price`, die App hatte dafür eine Rückfallregel
(`purchasePrice ?: unitPrice`), die es in der Webapp gar nicht gibt. Dass
die Zahlen übereinstimmten, lag allein daran, dass die Abfragen je Art nur
EINES der beiden Felder füllen.

Der Test hat zwei Teile, und beide werden gebraucht:
  • die RECHNUNG selbst (src/bestand/acquisitions.ts) — Randfälle inklusive
  • die REGEL, dass keine Oberfläche sie nochmal anstellt. Ohne den zweiten
    Teil wäre der erste in dem Moment wertlos, in dem jemand die Summe
    „schnell im Frontend" wieder einbaut.
```
