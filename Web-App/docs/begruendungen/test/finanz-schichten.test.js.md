# Begründungen zu `test/finanz-schichten.test.js`

Die ausführlichen Kommentare aus `test/finanz-schichten.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stelle"></a>
## `/** Die Reihenfolge — wer weiter unten steht, darf nichts weiter oben `

```text
Die Finanzschicht steht aufeinander — und zwar in EINE Richtung.

── Warum es diese Pruefung gibt (Nachtrag 171) ─────────────────────────────

src/finanzen/financeCalc.ts trug 1529 Zeilen und drei Aufgaben. Getrennt sieht die
Ordnung so aus:

    zustand.ts        die eine Zustandsregel — haengt an nichts
    abfragen.ts       Lesezugriffe, die mehr als eine Schicht braucht
    preise.ts         BrickLink, Zwischenspeicher, Anfragekontingent
    bewertung.ts      was ist der Bestand heute wert
    gewinnVerlust.ts  was hat er gekostet, was gebracht

Diese Reihenfolge ist keine Geschmacksfrage: Ein Griff nach oben — die
Preisschicht fragt die Bewertung — waere ein Kreis, und Node laedt im Kreis
ein halb fertiges Modul aus. Das faellt nicht beim Uebersetzen auf, sondern
zur Laufzeit und nur manchmal.

── Warum ich sie nicht geraten habe ────────────────────────────────────────

Meine erste Annahme war falsch: Ich hielt die Gewinnrechnung fuer
unabhaengig. Sie ruft die Bewertungen auf und sitzt damit UEBER ihnen.
Aufgefallen ist das erst, als `tsc` nach dem ersten Schnitt
`Cannot find name computePartsValuation` meldete. Diese Pruefung haelt fest,
was der Compiler gezeigt hat.
```

<a id="wurzel"></a>
## `const wurzel = path.join(__dirname, '..');`

```text
── Ein Name, zwei Bedeutungen (Nachtrag 172) ────────────────────────────

`type Blickfeld` stand DREIMAL im Baum — zweimal als `number | number[]`
(utils/handlers/), einmal als `number[]` (Finanzteil). Beide Fassungen
waren richtig und beschrieben doch Verschiedenes: vor `asIds()` darf es
eine einzelne ID sein, danach ist es immer eine Liste.

Derselbe Name fuer beides heisst, dass eine Signatur nicht mehr sagt, in
welchem der beiden Momente sie steht. Dasselbe Muster wie bei `code` als
Einladungstoken UND Fehlercode — das hat den Einladungscode unbrauchbar
gemacht, und zwar unbemerkt ueber Monate.

Jetzt zwei Namen, beide dort, wo `asIds()` zwischen ihnen uebersetzt.
```
