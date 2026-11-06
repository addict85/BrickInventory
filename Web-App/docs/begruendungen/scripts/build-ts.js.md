# Begründungen zu `scripts/build-ts.js`

Die ausführlichen Kommentare aus `scripts/build-ts.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stelle"></a>
## `const { execFileSync } = require('child_process');`

```text
Transpiliert alle .ts-Dateien nach .js — je Datei, KEIN Bundle, damit die
CommonJS-Modulgrenzen bleiben. Für `npm run build` und den Docker-Build;
public/ bleibt reines JavaScript.

Aufruf:
  node scripts/build-ts.js            → schreibt .js neben die .ts (in-place)
  node scripts/build-ts.js --outdir X → schreibt nach X/ (Verzeichnisbaum erhalten)
```
