# Begründungen zu `core-data/data/repository/KontoRepository.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/data/repository/KontoRepository.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="login"></a>
## `login`

```text
Verlangt der Server den zweiten Faktor, antwortet er mit 401 und
`zweiter_faktor: true`. Das wird hier zu einer gewöhnlichen Antwort mit
success=false umgebogen (wie GutscheineRepository.guthaben), sonst gingen
Kennzeichen und Satz in safeCall verloren. [passkey] ersetzt den Code.

Einen Token ohne Ablauf nur über https: Im Klartext kann ihn jeder im WLAN
mitlesen, und dann soll er wenigstens verfallen.
```
