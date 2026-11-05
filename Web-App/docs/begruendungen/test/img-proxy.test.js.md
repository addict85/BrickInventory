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

<a id="normalisierung"></a>
## `const normalisierung = SERVER_ONLY.slice(`

```text
`//api/img-proxy?…` trifft die Route NICHT und landet im SPA-Catch-all:
200 mit text/html, also die leere Anwendungshülle. Für ein <img> ergibt
das eine weisse Fläche bei Status 200 — ohne Log-Eintrag und ohne
Cache-Schreiben. Vier Symptome, die wie ein Proxy-Fehler aussehen.
Auf VERHALTEN geprüft, nicht auf die Schreibweise einer bestimmten Zeile:
Diese Prüfung hing am Wortlaut der ersten von zwei gleichwertigen
Middlewares. Als die überflüssige entfiel, wurde sie rot, obwohl die
Normalisierung unverändert stattfindet — genau die Sorte Test, die
Aufräumen teuer macht.
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

<a id="stelle-2"></a>
## `assert.match(SERVER, /mime\.startsWith\('image\/'\)/,`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
Der Content-Type kam ungeprüft vom CDN und wurde so gesetzt UND als
Sidecar im Cache abgelegt. Die Host-Liste ist eng und https2.get folgt
keinen Weiterleitungen (kein SSRF), aber auf den erlaubten CDNs liegen
teils von Nutzern hochgeladene Dateien. Käme dort ein SVG oder HTML
zurück, läge es anschliessend unter der EIGENEN Herkunft — und ein SVG
ist ein Dokument, das Skript enthalten kann. nosniff und die CSP fangen
den Ernstfall ab; eine Route namens img-proxy sollte trotzdem nichts
anderes als ein Bild ausliefern.

SVG ist bewusst ausgeschlossen: das einzige Bildformat, das als Dokument
geöffnet aktiv wird — und keines der angebundenen CDNs liefert Teile-
oder Setbilder als SVG.
```

<a id="stelle-3"></a>
## `assert.equal((CODE.match(/if \(req\.fresh\)/g) || []).length, 2,`

```text
── Woher dieser Test kommt ─────────────────────────────────────────────
Beide Auslieferpfade setzten einen ETag und `max-age=86400,
must-revalidate` — werteten If-None-Match aber nie aus. Nach Ablauf der
24 Stunden fragt der Browser nach und bekam jedes Mal das VOLLSTÄNDIGE
Bild zurück: bei einer Kachelwand mit hundert Teilen täglich einmal die
ganze Wand statt hundert leerer Antworten. Der ETag sah aus, als täte er
etwas, war aber wirkungslos.

Die Route /images/* hatte das Problem nie, weil res.sendFile die Prüfung
selbst übernimmt — die beiden Bildwege verhielten sich unterschiedlich.

Gegen den echten Proxy nachgestellt (rohe Anfrage, nicht fetch — Node
hängt bei manuellem If-None-Match automatisch „Cache-Control: no-cache"
an, worauf req.fresh korrekt false liefert):
  bekannter ETag → 304, 0 Bytes
  alter ETag     → 200, volles Bild
  no-cache       → 200, volles Bild
UMFORMULIERT in Nachtrag 135: Geprüft wurde der WORTLAUT
    if (req.fresh) return res.status(304).end();
Beim Auslagern der Cache-Auslieferung nach src/katalog/bilder/imgCacheServe.ts wurde
daraus `if (req.fresh) { res.status(304).end(); return true; }` — dort ist
`true` die Meldung „beantwortet" an den Aufrufer. Die Aussage ist
unverändert: BEIDE Auslieferpfade prüfen req.fresh und antworten mit 304.
CODE statt SERVER: ohne Kommentare. Sonst zählt die Prüfung Erklärtext
mit — beim Umzug nach imgCacheServe.ts hat mein eigener Kommentar
(„aus `return res.status(304).end();` darf kein blosses … werden") die
Zahl auf vier getrieben.
```

<a id="ein-fehlendes-bild-kommt-als-platzhalter"></a>
## `test('ein fehlendes Bild kommt als Platzhalter, und der Server merkt e`

```text
Ein fehlendes CDN-Bild kommt als PLATZHALTER zurück, nicht als 404.

── Marcos Befund ───────────────────────────────────────────────────────────

Beim Blättern durch alte Jahrgänge stand die Browser-Konsole voller roter
404. Fachlich waren sie richtig — Rebrickable hat zu vielen alten Sets kein
Bild —, aber sie sind nichts, woran jemand etwas ändern könnte, und sie
verdecken echte Fehler.

Der Platzhalter ist ohnehin das, was danach zu sehen ist: Beide Oberflächen
zeigen ihn, wenn kein Bild kommt. Ihn gleich auszuliefern spart den Umweg
über die Fehlerbehandlung.

── Was NICHT verlorengehen darf ────────────────────────────────────────────

Der Server muss sich die Fehlanzeige weiterhin merken. Sonst fragt er bei
jedem Aufruf erneut beim CDN nach — genau der Zustand, gegen den
src/katalog/bilder/imageMisses gebaut wurde. Deshalb prüft dieser Test BEIDES: dass der
Platzhalter geht UND dass merkeFehlend() weiter gerufen wird.
```
