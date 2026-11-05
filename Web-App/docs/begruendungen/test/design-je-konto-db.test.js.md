# Begründungen zu `test/design-je-konto-db.test.js`

Die ausführlichen Kommentare aus `test/design-je-konto-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Design je Konto: Der Verwalter setzt die Vorgabe, jedes Konto darf sie
überschreiben — über den echten Router und die echte Datenbank.

  - GET /api/v1/settings/theme liefert ohne Anmeldung die Vorgabe, mit
    Sitzung ODER Token (App) das Design des Kontos; `theme` bleibt der
    wirksame Wert, dazu `vorgabe` und `eigenes`.
  - POST /settings/user/theme setzt das eigene Design; leer löscht es, dann
    folgt das Konto wieder der Vorgabe (auch einem späteren Wechsel).
  - Ein unbekanntes Design wird abgewiesen.
  - /settings/raw und GET /api/v1/settings (App) nennen das wirksame Design.
  - Die ausgelieferte index.html trägt das Design des Kontos, ohne Konto
    die Vorgabe — auch für „noppe“ (vorher kannte sie nur classic/brick).
```
