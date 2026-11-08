# Begründungen zu `scripts/check-api-contract.js`

Die ausführlichen Kommentare aus `scripts/check-api-contract.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="path"></a>
## `const path = require('path');`

```text
API-Vertrag gegen einen laufenden Server: jede GET-Route des Vertrags
(src/vertrag/) ohne Platzhalter gegen ihr Schema. Die vollständige
Prüfung mit Bestand steht in test/vertrag-lesen-db.test.js; dieses Skript
ist für einen echten Bestand (nach `npm run build`).

  BASE_URL=http://localhost:3000 TOKEN=… node scripts/check-api-contract.js
  BASE_URL=… USERNAME=marco PASSWORD=… node scripts/check-api-contract.js

Exit-Code 0 = Vertrag eingehalten, 1 = Abweichungen, 2 = keine Anmeldung.
```
