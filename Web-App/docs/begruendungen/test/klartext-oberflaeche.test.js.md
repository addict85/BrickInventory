# Begründungen zu `test/klartext-oberflaeche.test.js`

Die ausführlichen Kommentare aus `test/klartext-oberflaeche.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Kein fester Text an einer Stelle, die der Nutzer liest.

── Die Regel gab es nur für die App ────────────────────────────────────────

Android-App/…/StringResourceParityTest besteht seit jeher darauf, dass in
`Text(...)`, `contentDescription` und `Toast` kein Literal steht. Die
Weboberfläche hatte nichts Vergleichbares — und beide sollen gleich gut zu
benutzen sein, nicht nur gleich aussehen.

── Der Befund ──────────────────────────────────────────────────────────────

NACHGEMESSEN standen ELF Texte fest im Quelltext. Sieben davon waren
Knopfbeschriftungen, die nach einem Klick ZURÜCKGESCHRIEBEN wurden:

    btn.textContent = 'Registrieren'   // im Markup: data-i18n="register.submit"

Zwei Folgen, beide unbemerkt: In einer englischen Oberfläche stand nach dem
ersten Klick ein deutsches Wort auf dem Knopf. Und das Literal stimmte nicht
einmal mit dem Wörterbuch überein — `register.submit` heisst „Konto
erstellen"; der Knopf beschriftete sich also auch auf Deutsch um.

Dazu vier Meldungen („Importiere…", „❌ Netzwerkfehler", „QR-Code
abgelaufen", „PDF.js nicht geladen") und das ganze Protokollfenster: sechs
Zeitspannen, Titel, Suchfeld und der Auto-Knopf, alle deutsch, in einem
Fenster, das ein englischsprachiger Verwalter genauso öffnet.

Das Gegenmittel bei den Knöpfen ist nicht ein weiterer Schlüssel, sondern
ein GEMERKTER Wert: `knopfBesetzt()` (01-dom.js) hält die Beschriftung fest
und gibt sie zurück. Damit gibt es keine zweite Fassung, die auseinander-
laufen kann.

── Was geprüft wird, und warum genau das ───────────────────────────────────

Nur Zuweisungen an `textContent`, `placeholder`, `title` sowie `toast()`,
`confirm()` und `alert()` — Stellen, an denen ein Literal ohne Umweg auf dem
Bildschirm landet. `innerHTML` steht bewusst NICHT dabei: Dort steht
überwiegend Markup mit eingesetzten Werten, und ein Muster, das darin Text
von Auszeichnung trennen will, erzeugt Fehlalarme — und eine Prüfung mit
Fehlalarmen wird abgeschaltet statt befolgt.

Ein Literal ohne zwei zusammenhängende Buchstaben ist kein Text: „…", „–",
„❌ " und Zahlen fallen durch dieselbe Maschen wie in der App.
```
