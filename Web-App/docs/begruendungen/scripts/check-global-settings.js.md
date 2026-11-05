# Begründungen zu `scripts/check-global-settings.js`

Die ausführlichen Kommentare aus `scripts/check-global-settings.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
`global_settings` wird über src/einstellungen/settings.ts angefasst, nicht direkt.

── Der Befund ──────────────────────────────────────────────────────────────
NACHGEMESSEN: Die Tabelle wurde aus 22 Dateien direkt gelesen — in VIER
verschiedenen Schreibweisen für dasselbe (`key=`, `key=$1`, `key = $1`,
`SELECT key, value` über alles) — und aus neun Stellen mit je eigenem
INSERT geschrieben. Genau EINE davon setzte `updated_at`; in den übrigen
acht blieb das Feld auf dem Wert des allerersten Anlegens stehen.

`getGlobalSetting()` gab es schon, benutzt haben es fünf Dateien.

── Warum eine Liste statt eines Verbots ────────────────────────────────────
Dasselbe Muster wie bei check-noimplicitany.js: Ein Schalter, der sofort 94
Meldungen erzeugt, wird nicht befolgt, sondern übergangen. Die Liste hält
den Bestand fest und darf nur KÜRZER werden — jede neue Stelle fällt sofort
auf, und der Bestand lässt sich in Ruhe abbauen.

── Was NICHT auf die Liste gehört ──────────────────────────────────────────
db/database.ts (legt die Tabelle an) und jobs/csvImportWorker.ts (eigener
Prozess mit eigenem Verbindungspool, kann utils/ nicht laden) sind
dauerhafte Ausnahmen und stehen deshalb unten separat.

Stand messen:  node scripts/check-global-settings.js
```

<a id="offen"></a>
## `const OFFEN = new Map([`

```text
Der Rest-Bestand. Diese Zahlen duerfen nur SINKEN.
Wer eine Datei leerraeumt, streicht ihre Zeile.

Beim Einfuehren der Pruefung standen hier 22 Dateien mit 92 Fundstellen. Was
jetzt noch uebrig ist, sind Erwaehnungen in Kommentaren. Die zaehlt die Pruefung mit,
weil sie nur nach dem Tabellennamen sucht — Absicht: lieber eine Zahl zu
hoch als eine echte Fundstelle uebersehen.
```
