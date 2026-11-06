# Begründungen zu `test/csv-prototyp.test.js`

Die ausführlichen Kommentare aus `test/csv-prototyp.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stelle"></a>
## `/** Den Einleser so aufrufen, wie der Import es tut. */`

```text
Eine CSV-Kopfzeile darf die Prototypenkette nicht treffen.

── Der Befund ──────────────────────────────────────────────────────────────

`npm audit` meldet fuer csv-parse: „Prototype replacement still reachable via
columns path". src/infra/csvExport.ts benutzte `columns: true` — damit wird jede
Kopfspalte zu einem Objektschluessel, `__proto__` eingeschlossen. Die CSV
kommt vom Benutzer (Import von Sets, Teilen, Minifiguren), der Pfad ist also
erreichbar.

Behoben ist es in der Bibliothek erst ab Hauptversion 7. Diese Pruefung
haengt nicht daran: Sie laeuft gegen den echten Einleser und zeigt, dass die
drei gefaehrlichen Namen NICHT im Ergebnis landen — egal, welche Version
installiert ist.

── Warum nicht nur die Quelle geprueft wird ────────────────────────────────

Ein Blick in den Quelltext („steht da `columns:` mit einer Funktion?") waere
wieder eine Rezeptpruefung. In dieser Sitzung sind drei Fehler genau daran
vorbeigelaufen: Der Glanz stimmte im Rezept und kam nicht an; der
Design-Wechsel nannte den richtigen Helfer und erreichte ihn nicht. Hier
laeuft deshalb der Parser selbst.
```
