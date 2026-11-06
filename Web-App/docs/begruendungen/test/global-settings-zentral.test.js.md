# Begründungen zu `test/global-settings-zentral.test.js`

Die ausführlichen Kommentare aus `test/global-settings-zentral.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
`global_settings` wird über src/einstellungen/settings.ts angefasst.

Der Wächter selbst steht in scripts/check-global-settings.js — dort mit der
Bestandsliste und der ausführlichen Begründung. Dieser Test ruft ihn im
normalen Lauf mit auf: Eine Prüfung, die man eigens starten muss, wird
vergessen.

Dasselbe Verhältnis wie bei check-noimplicitany.js und `npm run
typecheck:strict` — nur dass diese Prüfung keinen Übersetzerlauf braucht und
deshalb im Testlauf nichts kostet.
```
