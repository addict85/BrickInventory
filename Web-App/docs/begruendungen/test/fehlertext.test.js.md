# Begründungen zu `test/fehlertext.test.js`

Die ausführlichen Kommentare aus `test/fehlertext.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein gefangener Fehler ergibt IMMER einen lesbaren Text.

── Der Befund ──────────────────────────────────────────────────────────────
`catch (e) { … e.message … }` stand an 91 Stellen, und der gefangene Wert
war `any`. In JavaScript darf aber alles geworfen werden, nicht nur ein
Error: eine Zeichenkette (`throw 'kaputt'`), ein Objekt ohne `message`, bei
einem abgelehnten Versprechen auch `undefined`. In genau diesen Faellen war
`e.message` seinerseits `undefined` — und beim Nutzer stand
„Fehler: undefined", also die eine Meldung, mit der niemand etwas anfangen
kann.

Der Schalter `useUnknownInCatchVariables` hat die Stellen sichtbar gemacht;
fehlertext() behebt sie inhaltlich. Dieser Test haelt das Verhalten fest —
der Schalter allein wuerde eine Fassung durchgehen lassen, die zwar
uebersetzt, aber weiterhin „undefined" liefert.
```
