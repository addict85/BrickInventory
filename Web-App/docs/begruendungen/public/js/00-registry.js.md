# Begründungen zu `public/js/00-registry.js`

Die ausführlichen Kommentare aus `public/js/00-registry.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="js-11-actions-js-loest-die-handler-aus-d"></a>
## js/11-actions.js löst die Handler aus data-click="name" auf. Bisher tat es

```text
── Handler-Registrierung für den Ereignis-Dispatcher ────────────────────────

── Warum es das gibt ───────────────────────────────────────────────────────
js/11-actions.js löst die Handler aus data-click="name" auf. Bisher tat es
das über `window[name]` — was funktionierte, weil alle Handler klassische
Funktionsdeklarationen auf oberster Ebene und damit global waren.

Genau diese Annahme fällt mit der Umstellung auf ES-Module: Top-Level-
Deklarationen eines Moduls liegen NICHT auf window. Ohne Ersatz wären
schlagartig alle 73 Handler tot — und zwar nicht beim Laden, sondern erst
beim Klicken, also genau dort, wo es niemand vorher bemerkt.

Die Registrierung macht die Verbindung zwischen Markup-Attribut und Funktion
explizit. Nebeneffekt: `data-click="etwasTippfehler"` fällt jetzt beim
Prüfen auf (test/dom-ids.test.js gleicht die Namen gegen die Registry ab),
statt still nichts zu tun.
```
