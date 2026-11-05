# Begründungen zu `test/bedienelement-name.test.js`

Die ausführlichen Kommentare aus `test/bedienelement-name.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jedes sichtbare Bedienelement hat einen Namen, den man VORLESEN kann.

── Der Befund ──────────────────────────────────────────────────────────────

NACHGEMESSEN trugen ELF sichtbare Knöpfe in index.html nur ein Symbol als
Inhalt und sonst nichts: acht Schliessen-Kreuze (✕) der Dialoge, zwei
Papierkörbe (🗑️) zum Löschen und die beiden Umschalter zwischen Karten- und
Tabellenansicht (⊞ / ☰).

Ein Bildschirmleser sagt dazu entweder gar nichts oder den Unicode-Namen des
Zeichens („multiplication x"). Wer die Oberfläche sieht, merkt davon nichts —
dieselbe Sorte Fehler wie die fehlenden aria-label-Schlüssel aus Nachtrag
142, und aus demselben Grund so lange unbemerkt.

Dazu ein zwölfter Fall, den die erste Messung ÜBERSAH, weil er ein
aria-label HAT: `<select id="mon-default-condition" aria-label=
"mon-default-condition">`. Vorgelesen wurde der Bezeichner selbst.

── Die App hat diese Regel seit jeher ──────────────────────────────────────

Android-App/…/IconButtonLabelTest.kt besteht darauf, dass jeder IconButton
eine contentDescription trägt. Die Weboberfläche hatte nichts Vergleichbares
— beide Oberflächen sollen aber gleich gut bedienbar sein, nicht nur gleich
aussehen.

── Was als Name zählt ──────────────────────────────────────────────────────

  aria-label / aria-labelledby / title       direkt am Element
  data-i18n OHNE data-i18n-attr              setzt textContent zur Laufzeit
  ein <label for="…">                        gehört zum Element
  sichtbarer Text mit mindestens zwei Buchstaben

Ein Emoji oder ein Symbol zählt NICHT — genau darum geht es.

── Was NICHT geprüft wird, und warum ───────────────────────────────────────

Elemente in einem `display:none`-Teilbaum. In index.html stehen sechs leere
Knöpfe („Hidden stubs so existing JS references don't break"); sie sind für
einen Bildschirmleser gar nicht vorhanden. Sie hier zu melden hiesse, eine
Regel an einer Stelle zu erzwingen, an der sie nichts bewirkt — und drei
Fehlalarme sind genug, damit die ganze Prüfung abgeschaltet wird.
```
