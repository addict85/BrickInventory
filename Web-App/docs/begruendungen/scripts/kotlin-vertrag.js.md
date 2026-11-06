# Begründungen zu `scripts/kotlin-vertrag.js`

Die ausführlichen Kommentare aus `scripts/kotlin-vertrag.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="vergleiche"></a>
## `function vergleiche(t, schema, modelle, aufloesen, ort = '$', o = {}) `

```text
Passt ein Kotlin-Typ zu einem JSON-Schema des Vertrags (docs/openapi.json)?
Geprüft wird, was die App beim Lesen braucht: Jedes Feld des Modells steht
im Schema (unter seinem JSON-Namen), mit passendem Typ; was das Schema null
sein lässt, ist in Kotlin nullbar; was das Schema weglassen darf, hat in
Kotlin einen Standardwert. Bei GET-Routen zählt auch ein Feld mit
Standardwert als Pflicht (sonst überdeckte der Standard ein vergessenes
Feld), ausser es ist nullbar oder steht in FEHLEN_ERLAUBT.
```
