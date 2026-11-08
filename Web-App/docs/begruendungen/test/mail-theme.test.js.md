# Begründungen zu `test/mail-theme.test.js`

Die ausführlichen Kommentare aus `test/mail-theme.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
E-Mails im Design der Webapp.

E-Mails kennen keine CSS-Variablen und kein externes Stylesheet — jeder Wert
muss direkt im Markup stehen. Die Paletten in src/mail/mailer.ts spiegeln
deshalb styles.css bzw. themes/brick.css. Ändert sich dort eine Farbe, muss
sie hier nachgezogen werden; dieser Test hält wenigstens fest, dass es
überhaupt zwei unterscheidbare Paletten gibt und sie angewendet werden.

Ausführen: npm test
```
