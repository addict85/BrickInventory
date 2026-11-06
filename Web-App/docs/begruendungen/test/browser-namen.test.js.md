# Begründungen zu `test/browser-namen.test.js`

Die ausführlichen Kommentare aus `test/browser-namen.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Typprüfung der Oberfläche: kein unbekannter Name, keine Meldung.

Ein Tippfehler in einem Namen oder ein Feld, das ein Element nicht hat,
fällt im Browser erst auf, wenn die Zeile läuft. tsc prüft deshalb die
ES-Module unter public/js samt i18n.js (tsconfig.frontend.json) und die
zwei klassischen Skripte (tsconfig.frontend-skripte.json) — derselbe Lauf
wie `npm run typecheck:frontend` und der Schritt in der CI.
```
