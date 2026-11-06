# Begründungen zu `public/js/01-monitor.js`

Die ausführlichen Kommentare aus `public/js/01-monitor.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="dieser-block-lag-in-js-01-core-js-deren"></a>
## Dieser Block lag in js/01-core.js. Deren Kopfzeile nennt als Inhalt „Utils,

```text
── Überwachung: Jobliste im Reiter „Monitoring" und das Protokollfenster ────

── Warum eine eigene Datei ──────────────────────────────────

Dieser Block lag in js/01-core.js. Deren Kopfzeile nennt als Inhalt „Utils,
i18n-Glue, Auth & Panels, Login/Logout, CSV-Import-Fortschrittsbalken" — die
Überwachung stand nicht darin. Sie war damit nicht nur gross, sondern in
einer Datei, die selbst behauptete, sie nicht zu enthalten.

Dass openLogViewer() zwischen dem Fortschrittsbalken und der Jobliste
eingekeilt war, statt bei ihr, ist das Merkmal einer Ablage: Wer etwas
hinzufügt, hängt es dort an, wo er gerade liest. Hier stehen jetzt beide
Seiten der Überwachung beieinander — die Liste, die zeigt, was läuft, und
das Fenster, das zeigt, was dabei protokolliert wurde.
```
