# Begründungen zu `src/mail/vorlage.ts`

Die ausführlichen Kommentare aus `src/mail/vorlage.ts`, wörtlich (bis zur Aufteilung von
`mailer.ts` standen sie in `mailer.ts.md`). Im Code steht je Stelle der erste Absatz
und ein Verweis hierher.

<a id="mailtheme"></a>
## `MailTheme`

```text
Farbpalette je Design.

E-Mails kennen keine CSS-Variablen und kein externes Stylesheet — jeder Wert
muss direkt im Markup stehen. Die Paletten sind daher aus themes/*.css bzw.
styles.css abgeleitet und hier gespiegelt.

Das Design ist eine GLOBALE Einstellung (`app_theme` in global_settings),
nicht pro Nutzer — der Mailer liest sie beim Versand.
```

<a id="infobox"></a>
## `infoBox`

```text
Hinweiskasten in der Mail.

── Der Parameter war da und wurde ignoriert ────────────────────────────────
`theme` stand seit jeher in der Signatur, aber die Farben waren fest
verdrahtet (#eff6ff/#bfdbfe/#1e40af — das Blau des klassischen Designs). Im
Stein-Design blieb der Kasten deshalb blau, waehrend Kopf, Knopf und
Hintergrund umschalteten.

Gefunden von noUnusedParameters: Ein Parameter, den niemand liest, ist
entweder ueberfluessig — oder er sollte benutzt werden und wurde vergessen.
Hier das Zweite; mail-theme.test.js prueft seit jeher, dass die Funktion ihn
ENTGEGENNIMMT, und genau das war zu wenig.

`border` und `text` kommen aus dem Design, der Hintergrund bleibt eine helle
Tonung: `surface` waere weiss und der Kasten damit unsichtbar.
```
