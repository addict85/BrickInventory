# Begründungen zu `test/kaufadressen.test.js`

Die ausführlichen Kommentare aus `test/kaufadressen.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die zwei Kaufadressen am Set-Detail: BrickLink und Preisvergleich.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

„Bitte auf dem Detail-Dialog sowohl den BrickLink-Link analog dem Katalog
als auch die URL des Preisvergleichs als Buttons einbauen."

── Warum der SERVER sie liefert ────────────────────────────────────────────

„Analog dem Katalog" ist woertlich: Der Katalog laesst die
BrickLink-Adresse seit jeher vom Server aufloesen, weil sie sich NICHT aus
der Setnummer herleiten laesst — Gear und Buecher liegen unter einem
anderen Parameter, Sammelminifiguren unter einer ganz anderen Nummer.

Der Preisvergleich kommt aus demselben Grund von dort: Seine Adresse stand
bisher an genau EINER Stelle im Baum (dem Vergleichsbildschirm der App).
Ohne src/katalog/preisvergleich.ts waeren daraus vier geworden — Webapp und App,
je Set-Detail und Vergleich.

Der dritte Test unten ist der Waechter dafuer: Baut irgendwann doch wieder
eine Oberflaeche die Adresse selbst, faellt es hier auf und nicht erst,
wenn zwei davon auseinanderlaufen.
```
