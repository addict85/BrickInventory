# Begründungen zu `src/katalog/bilder/imgCacheServe.ts`

Die ausführlichen Kommentare aus `src/katalog/bilder/imgCacheServe.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="liefereauscache"></a>
## `liefereAusCache`

```text
Ein Bild aus dem Platten-Cache ausliefern, falls es dort liegt.

Rückgabe `true` = beantwortet, der Aufrufer ist fertig. `false` = nicht im
Cache, es muss beim CDN geholt werden.

── Warum eigene Datei (Nachtrag 135) ───────────────────────────────────────

`registerImgProxy()` war nach dem Auslagern der Vorschau-Maschinerie
(Nachtrag 129) noch 531 Zeilen — davon rund 430 der EINE Route-Handler. Der
ist ein langer, linearer Ablauf: anmelden, Adresse prüfen, Host zulassen,
Cache-Pfad bauen, aus dem Cache ausliefern, sonst beim CDN holen und dabei
mitschreiben.

Der Cache-Treffer ist davon das am klarsten abgegrenzte Stück und zugleich
der HEISSESTE Pfad — bei einer Kachelwand läuft praktisch jede Anfrage hier
durch und nirgendwo sonst. Er verdient es, für sich lesbar zu sein.

Die Schnittstelle ist schmal und war es schon vorher: die beiden Pfade, die
zwei Flaggen, `res` und ein Rückruf für „vorgemerkt, aber nicht gerechnet".
```

<a id="liefereauscache-2"></a>
## Abschnitt

```text
Kennt der Browser die Datei schon, reicht ein leeres 304.

Der ETag wurde bisher zwar gesetzt, aber nie ausgewertet: Nach Ablauf
der 24 Stunden fragt der Browser mit If-None-Match nach — und bekam
jedes Mal das VOLLSTÄNDIGE Bild zurück. Bei einer Kachelwand mit
hundert Teilen ist das täglich einmal die ganze Wand statt hundert
Kopfzeilen. Die Route /images/* hatte das Problem nie, weil
res.sendFile die Prüfung selbst übernimmt — die beiden Bildwege
verhielten sich also unterschiedlich.

req.fresh vergleicht If-None-Match/If-Modified-Since gegen die eben
gesetzten Kopfzeilen; es gilt nur für GET und HEAD.
`return true` statt nur `return`: Für den Aufrufer ist auch die 304
eine fertige Antwort. Beim Herauslösen wäre hier fast ein Fehler
entstanden — aus `return res.status(304).end();` darf kein blosses
`res.status(304).end();` werden, sonst liefe der Ablauf weiter und
schriebe in eine bereits beendete Antwort.
```
