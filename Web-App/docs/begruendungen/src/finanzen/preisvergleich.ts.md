# Begründungen zu `src/finanzen/preisvergleich.ts`

Die ausführlichen Kommentare aus `src/finanzen/preisvergleich.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="basis"></a>
## `BASIS`

```text
Preisvergleich — die Adresse zum Nachsehen, was es anderswo kostet.

── Warum das hier steht und nicht in den Oberflaechen ──────────────────────

Bis jetzt stand `https://www.toppreise.ch/produktsuche?q=` an genau EINER
Stelle: im Vergleichsbildschirm der App (ui/screens/ComparisonScreen.kt).
Marcos Wunsch, denselben Knopf auch im Set-Detail zu haben, haette daraus
ohne diese Datei vier Stellen gemacht — Webapp und App, je Set-Detail und
Vergleich.

Es ist derselbe Weg, den der BrickLink-Knopf schon geht: Der Server loest
die Adresse auf (utils/bricklinkLink.ts), die Oberflaechen zeigen sie nur.
Wer den Anbieter wechseln will, aendert eine Zeile statt vier.

── Warum toppreise.ch ──────────────────────────────────────────────────────

Weil es das ist, was die App seit jeher benutzt, und der Baum in der
Schweiz steht (Waehrung CHF, Sprache de-CH). Das ist keine Empfehlung,
sondern der bestehende Zustand — wer etwas anderes will, findet hier die
eine Zeile dafuer.
```
