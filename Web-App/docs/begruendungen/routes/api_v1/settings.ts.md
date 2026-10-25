# Begründungen zu `routes/api_v1/settings.ts`

Die ausführlichen Kommentare aus `routes/api_v1/settings.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="app-felder"></a>
## `APP_FELDER`

```text
Was die App aus den Einstellungen liest — ausdrücklich aufgezählt.

Gegenstück zu `UserSettings` in AuthModels.kt der Android-App. Die Liste
hier IST die Kuratierung: Die Webapp bekommt unter /api/settings zusätzlich
die globalen und die Admin-Felder; die App braucht sie nicht und soll sie
nicht bekommen. Das war schon vor diesem Umbau die Entscheidung (siehe
test/api-parity.test.js) und bleibt es.

Neu ist nur, WOHER die Werte kommen: aus readSettings(), also aus derselben
Quelle wie die Webapp.
```

<a id="get-settings-user-default-condition"></a>
## `get-/settings/user/default-condition`

```text
GET /api/v1/settings/user/default-condition — der EFFEKTIVE Wert des
Nutzers, zum Vorbelegen der Erfassungsformulare.

Etappe 6: Vorher gab es diesen Wert nur auf zwei ganz verschiedenen Wegen —
die Webapp über eine eigene Route mit eigener Abfrage, die App als Feld in
GET /settings. Die Route hier bedient jetzt beide; das Feld in /settings
bleibt, weil die App es in derselben Antwort mitliest.
```
