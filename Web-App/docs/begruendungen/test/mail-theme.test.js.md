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

<a id="stelle"></a>
## `assert.match(funktionsKopf(SRC, name), /theme\s*(?::[^=]+)?=\s*MAIL_TH`

```text
Die Vorgabe ist der Punkt: Ohne sie müsste jeder Aufrufer das Design
mitgeben, und ein vergessener Aufruf fiele auf undefined statt auf classic.
Die Typannotation steht ZWISCHEN Name und Vorgabe
(`theme: MailTheme = MAIL_THEMES.classic`) — der Kommentar oben hatte
das bereits als Bruchstelle benannt, dieses Muster liess sie aber noch
offen. Der Teil dazwischen ist jetzt ausdruecklich erlaubt.
```
