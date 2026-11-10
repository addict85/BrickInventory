# Begründungen zu `test/alarm-direktlink-beide.test.js`

Die ausführlichen Kommentare aus `test/alarm-direktlink-beide.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine Meldung führt zum SET — angetippt auf dem Telefon, angeklickt in der
Mail.

── Marcos Wunsch vom 25.09. ────────────────────────────────────────────────

  „Kannst du noch umsetzen, dass ich in der Android App die notification
   anklicken kann und dann die App sowie das Set im Detaildialog geöffnet
   wird. Bei den Mails wäre es schön wenn es ebenfalls einen direkt link auf
   die Webapp mit dem entsprechenden Set geben würde."

── Warum das eine Regel über BEIDE ist ─────────────────────────────────────

Es sind zwei Wege zum selben Ziel, und jeder besteht aus zwei Hälften, die
unabhängig voneinander kaputtgehen können:

    Meldung trägt ein Ziel   +   die App löst es ein
    Mail trägt einen Link    +   die Webapp löst ihn ein

Genau daran ist es schon einmal gescheitert, und zwar an MIR: Ich habe am
25.09. den Knopf in die Mail gebaut, der auf `/?set=<nummer>` zeigt — ohne
nachzusehen, ob die Webapp diesen Parameter überhaupt liest. Sie las ihn
nicht. Der Knopf öffnete die Startseite, und das sah aus wie ein Link, der
funktioniert.

Eine halbe Brücke ist schlimmer als keine: Sie verspricht etwas.
```
