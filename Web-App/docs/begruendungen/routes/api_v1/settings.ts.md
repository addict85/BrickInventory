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

<!-- Bis zum Zusammenlegen der Router stand der folgende Teil in routes/settings.ts. -->

<a id="abschnitt"></a>
## Abschnitt

```text
── Angemeldete Geräte: Sitzung ODER Token ───────────────────────────────────

MUSS vor router.use(requireLogin) stehen — aus demselben Grund wie /theme
darüber, nur andersherum: Nicht weil gar keine Anmeldung nötig wäre,
sondern weil requireLogin NUR die Sitzung kennt. Die App hat keine; sie
weist sich mit einem Bearer-Token aus.

GEMESSEN: Mit den Routen hinter dem Gatter antwortete /tokens der App mit
401 — die Verwaltung der App-Zugänge war für die App selbst unerreichbar.
Die beiden Routen bringen ihre eigene Absicherung mit
(requireLoginOrToken), es fällt also nichts weg.
```

<a id="get-tokens"></a>
## `get-/tokens`

```text
GET /api/v1/settings/tokens — die eigenen Zugänge auflisten.

── Warum es das jetzt in der Oberfläche gibt ───────────────────────────────
Diese Route und ihr DELETE-Gegenstück gab es schon; einen WEG dorthin nicht.
Damit war ein verlorenes oder verkauftes Telefon nur loszuwerden, indem man
das Passwort ändert (das verwirft seit Nachtrag 3 alle Token). Wer nur EIN
Gerät aussperren will, musste alle anderen mit aussperren.

── Was herausgegeben wird, und was nicht ───────────────────────────────────
`token_id` sind die ersten 16 Zeichen des SHA-256-HASHES, nicht des Tokens.
Daraus lässt sich der Token nicht zurückrechnen; er reicht aber, um die
Zeile beim Löschen wiederzufinden. Der Klartext-Token existiert auf dem
Server ohnehin nicht mehr — er wurde einmal ausgegeben und nie gespeichert.

`aktuell` markiert den Zugang, mit dem GERADE gefragt wird. Ohne das kann
man sich mit dem eigenen Knopf selbst aussperren, ohne es zu merken. Der
Client schickt dafür seinen Token im Authorization-Header mit; die Sitzung
allein sagt nichts darüber, WELCHE Zeile zu ihr gehört.
```

<a id="get-tokens-tokens"></a>
## `tokens`

```text
LEAST ueber beide Fristen: `expires_at` ist die gleitende („so lange
ungenutzt"), `hard_expires_at` die feste, die beim QR-Code gewaehlt
wurde. Was den Nutzer interessiert, ist der FRUEHERE der beiden — der
Tag, an dem dieses Geraet ausgesperrt wird.

LEAST ist dafuer der richtige Griff und nicht bloss der kuerzere: Es
uebergeht NULL-Werte, statt selbst NULL zu werden (anders als eine
Addition oder ein CASE, den man von Hand schreiben muesste). Ohne feste
Frist kommt also weiterhin genau `expires_at` heraus.

`hard_expires_at` steht zusaetzlich in der Antwort, damit die
Oberflaeche „laeuft am … endgueltig ab" von „laeuft ab, wenn 90 Tage
lang ungenutzt" unterscheiden kann. Beides ist derselbe Balken, aber
nicht dieselbe Aussage.
```

<a id="delete-tokens-tokenid"></a>
## `delete-/tokens/:tokenId`

```text
DELETE /api/v1/settings/tokens/:tokenId — einen Zugang entwerten.

── Zur Wirkungsverzögerung, ehrlich gesagt ─────────────────────────────────
Die Zeile ist sofort weg. Der In-Memory-Cache in src/konto/auth.ts ist aber
nach dem KLARTEXT-Token indiziert, und den hat der Server nicht — gezielt
entfernen lässt er sich also nicht. Deshalb wird er hier ganz geleert, wie
beim Passwortwechsel (revokeAllTokens). Das wirkt sofort, allerdings nur im
Arbeitsprozess, der die Anfrage bearbeitet: Im Cluster können die übrigen
den Token noch bis zu TOKEN_TTL_MS (eine Minute) bedienen.

Für „Telefon verloren" ist eine Minute ohne Belang. Wer mehr braucht,
ändert das Passwort — das verwirft zusätzlich alle Sitzungen.
```

<a id="post"></a>
## `post-/`

```text
── GET /api/settings ist ENTFERNT ───────────────────────────────────────────

Sie lieferte GENAU DASSELBE wie GET /raw achtzig Zeilen weiter unten —
beide riefen readSettings(userId, isAdmin) —, nur in einer anderen Huelle:
hier ausgebreitet (`{ success, ...settings }`), dort verschachtelt
(`{ success, settings }`). Zwei Adressen, eine Abfrage, zwei Formen.

Aufrufer hatte nur die zweite: Die Webapp holt /settings/raw (01-core.js und
05-settings.js), die App /api/v1/settings. Nachgemessen ueber beide Baeume.

Nebeneffekt, der den Umzug erst moeglich macht: `GET /api/v1/settings` gibt
es bereits — mit der fuer die App kuratierten Auswahl. Waere diese Route
mitgezogen, staenden zwei verschiedene Antworten auf derselben Adresse.
```
