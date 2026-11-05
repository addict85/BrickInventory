# Begründungen zu `scripts/check-antwortfelder.js`

Die ausführlichen Kommentare aus `scripts/check-antwortfelder.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="fs-stelle"></a>
## `const fs = require('fs');`

```text
Kein Antwortfeld ohne Verbraucher.

── Woher diese Prüfung kommt ───────────────────────────────────────────────
Auf der Android-Seite hat die Frage „welches Feld wird gesetzt und nie
gelesen?" drei echte Fehler gefunden. Hier ist die Entsprechung: Welchen
Schlüssel legt der Server in eine Antwort, den kein Client je anfasst?

Der erste Treffer war `rate_limit` in /v1/finance/valuation. Ein Kommentar
daneben behauptete, die Webapp zeige damit den API-Verbrauch an — sie tut es
nicht, sie liest `rate_limits` (Plural) aus /v1/admin/cache-stats. Gekostet
hat der Schlüssel drei Datenbankabfragen je Aufruf, bei jedem Öffnen des
Finanzreiters und nach jedem Erfassen.

Das ist der Punkt: Ein unbenutztes Feld ist hier nicht nur tot, es ist ein
Abruf, den jemand bezahlt. Und es fällt nie von selbst auf — die Antwort
wird ja grösser, nicht kleiner.

── Was geprüft wird ────────────────────────────────────────────────────────
Jeder Schlüssel der OBERSTEN Ebene aus `res.json({ … })` muss in mindestens
einem Verbraucher namentlich vorkommen: dem Webapp-Frontend (public/js, ohne
das erzeugte Bündel) oder der Android-App. Beide liegen in dieser Ablage,
die Frage ist also vollständig beantwortbar.

Was NICHT geprüft wird: Felder aus `...spread` — die tragen Spaltennamen und
gehören zur Datenschicht, nicht zur Antwortform.
```
