# Begründungen zu `test/img-proxy.test.js`

Die ausführlichen Kommentare aus `test/img-proxy.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="server-only"></a>
## `const SERVER_ONLY = require('./helpers/sources').startQuelle();`

```text
Der Bild-Proxy ist aus server.ts nach routes/imgProxy.ts gewandert (server.ts
war mit über 1200 Zeilen wieder ein kleiner Monolith aus Proxy, Thumb-Queue,
Cluster-Setup und Startup-Orchestrierung). Die hier geprüften Sachverhalte
gelten unverändert — sie verteilen sich jetzt nur auf zwei Dateien:

  SERVER_ONLY — was in server.ts geblieben ist (Pfad-Normalisierung,
                Reihenfolge der Middleware, Hintergrundläufe)
  PROXY       — der Proxy selbst
  SERVER      — beides zusammen, für Prüfungen der Art "kommt X irgendwo vor"
```

<a id="stelle"></a>
## `assert.match(SERVER, /SELECT mc\.fig_number, mc\.image_url FROM minifi`

```text
Vorher lud der Hintergrundlauf nur `source='manual'`. Minifiguren aus Sets
liefen dadurch dauerhaft über /api/img-proxy: Anmeldeprüfung, Cache-Suche
und Stream bei jeder Kachel, beim ersten Anzeigen ein CDN-Roundtrip je
Bild. Set-Bilder liegen längst lokal und gehen über express.static.
Gelesen wird seit Migration 0034 aus minifigs_catalog — dort steht jede
Figur EINMAL. Das DISTINCT ON stand hier, weil die Abfrage auf minifigs
lief und dieselbe Figur je Konto eine Zeile hatte; jetzt erledigt das der
Primaerschluessel.
```
