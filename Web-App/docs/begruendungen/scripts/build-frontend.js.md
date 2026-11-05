# Begründungen zu `scripts/build-frontend.js`

Die ausführlichen Kommentare aus `scripts/build-frontend.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stelle"></a>
## `const { execFileSync } = require('child_process');`

```text
Bündelt und minifiziert das Frontend.

── Von Verkettung zu echtem Bundling ───────────────────────────────────────
Vorher wurden die Dateien nur ANEINANDERGEHÄNGT, weil sie sich einen globalen
Namensraum teilten und ein Modul-Bundler die gegenseitigen Zugriffe zerrissen
hätte. Seit der Umstellung auf ES-Module ist das anders: Jede Datei benennt
ihre Importe und Exporte, und esbuild löst den Graphen selbst auf.

Das bringt drei Dinge, die die Verkettung nicht konnte:
  • Tree-Shaking — ungenutzte Exporte fallen raus.
  • Echte Modulgrenzen — ein `const x` in einer Datei kollidiert nicht mehr
    mit einem gleichnamigen in einer anderen (genau so hat sich der Fehler
    "PARTS_ICON_SVG ist schon deklariert" seinerzeit gezeigt).
  • Die Auswertungsreihenfolge folgt dem Importgraphen statt der
    Dateinamen-Nummerierung.

Ausgabe ist bewusst format=iife und KEIN type="module" im Browser: Das
Bündel läuft damit als ein einziges klassisches Skript, was die
Ladereihenfolge gegenüber 00-theme-boot.js und den Sprachdateien unverändert
lässt.

Aufruf:
  node scripts/build-frontend.js          → public/js/app.bundle.js
  node scripts/build-frontend.js --check  → prüft nur die Dateizuordnung
```
