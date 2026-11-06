# Begründungen zu `test/currency-change-db.test.js`

Die ausführlichen Kommentare aus `test/currency-change-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Währungswechsel stösst den Preis-Job an — gegen echte Routen und Tabelle.

── Warum es diese Datei gibt ───────────────────────────────────────────────
Der Preis-Cache ist über set_number + condition + currency_code
verschlüsselt. Nach einem Währungswechsel ist deshalb JEDER Cache-Zugriff
ein Fehlschlag, und die Bewertung versucht je Set einen Live-Abruf bei
BrickLink — im Anfragepfad. Das Lastprofil (Nachtrag 27b) hat es gemessen:
21 Sekunden statt 53 Millisekunden für den Finanzreiter.

Seit Nachtrag 28 stösst eine ECHTE Währungsänderung den Preis-Job an, der
den Cache im Hintergrund für die neue Währung füllt. Die Regel liegt in
setUserSetting() (src/konto/nutzerEinstellung.ts) — der EINEN Schreibstelle für
Benutzereinstellungen — und gilt damit für alle drei Wege: Webapp-Formular,
Einstellungs-Import und /api/v1.

Geprüft wird VERHALTEN: Der Preis-Job ist ein geplanter Auftrag
(src/auftraege/zeitplan.ts); ein Anstoss zieht seinen Termin auf jetzt vor.
Erwartung:
  • Währung EUR → CHF        : der Termin ist jetzt fällig
  • dieselbe Währung nochmal : der Termin bleibt in der Zukunft (das Formular
    schickt bei jedem Speichern alle Felder — jedes Speichern dürfte sonst
    einen Lauf kosten)
  • v1-Route                 : gleiches Verhalten (Parität)
```
