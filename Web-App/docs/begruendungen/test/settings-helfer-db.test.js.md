# Begründungen zu `test/settings-helfer-db.test.js`

Die ausführlichen Kommentare aus `test/settings-helfer-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Schreib-/Löschwege in src/einstellungen/settings.ts und der Auslöser in
src/auftraege/repository/laufzustand.ts (seit Migration 0063 dort) gegen eine echte Datenbank.

── Warum dieser Test sein muss ─────────────────────────────────────────────
Der Auslöser und deleteGlobalSetting() sind beim Zentralisieren neu
entstanden und tragen SQL, das es vorher nirgends gab:
  • `WHERE key = ANY($1)` mit einem Array als Parameter,
  • `VALUES ($1, NOW()::TEXT)`.
Beides übersetzt der pg-Treiber selbst. Ob er ein JS-Array als Postgres-Array
abliefert, sagt kein Typprüfer — das sagt nur ein Aufruf.

Der eigentliche Grund für den Test ist aber der Löschweg: Wer `key = ANY($1)`
mit einem falschen Parameter aufruft, bekommt keine Fehlermeldung, sondern
im schlimmsten Fall eine leere Tabelle — und damit ein Konto ohne
Registrierungssperre, ohne API-Grenzen und ohne BrickLink-Zugang. Deshalb
prüft Teilschritt 4 ausdrücklich, dass ein Aufruf OHNE Schlüssel nichts
anfasst.
```
