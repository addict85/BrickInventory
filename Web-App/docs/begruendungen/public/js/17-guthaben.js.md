# Begründungen zu `public/js/17-guthaben.js`

Die ausführlichen Kommentare aus `public/js/17-guthaben.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kannst-du-dies-bei-den-gutscheinen-einba"></a>
## „Kannst du dies bei den Gutscheinen einbauen, damit dies auf Knopfdruck

```text
═══ Guthaben bei LEGO abfragen ════════════════════════════════════════════

── Marcos Vorgaben ────────────────────────────────────────────────────────

„Kannst du dies bei den Gutscheinen einbauen, damit dies auf Knopfdruck
 abgefragt und gespeichert werden kann?"

„Bitte auch dafür sorgen dass maximal 1 Request pro 30sek abgesetzt werden
 kann. (über alle Benutzer)"

── Warum die OBERFLÄCHE taktet und nicht der Server ───────────────────────

Die Grenze selbst steht auf dem Server (src/gutscheine/gutscheinGuthabenSchranke.ts)
und gilt dort für alle Benutzer und alle Arbeitsprozesse — hier wird sie
nicht nachgebaut, sondern BEFOLGT: Kommt 429 mit `wartenSek`, wartet diese
Schleife die Zeit ab und fragt dieselbe Karte erneut.

Eine Sammelroute auf dem Server hätte dieselbe Wartezeit innerhalb EINER
HTTP-Anfrage absitzen müssen — bei fünf Karten über zwei Minuten mit offener
Verbindung. Die Begründung steht ausführlich an der Route.

Und deshalb zählt der Fortschritt mit: Wer „alle abfragen" drückt, wartet
Minuten, und ein Knopf, der nur ausgegraut ist, sagt ihm nicht, ob noch
etwas passiert.
```
