# Begründungen zu `utils/setImages.ts`

Die ausführlichen Kommentare aus `utils/setImages.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Set-Bilder vom CDN holen und lokal ablegen.

── Warum diese Funktion nicht mehr in routes/sets.ts steht (Nachtrag 125) ──

Sie hat zwanzig Aufrufer — Routen, Jobs, den Katalog — und KEINER davon
konnte sie importieren: `routes/sets.ts` ist ein Router, und wer ihn
importiert, schliesst einen Kreis (sets → parts → sets, sets → minifigs →
sets, imageQueue → sets → …). Alle zwanzig holten sie deshalb per spätem
`require()` aus dem Funktionsrumpf.

Der Preis dafür war nicht theoretisch: `require()` liefert `any`, also prüft
TypeScript den NAMEN nicht. Genau daran hingen die beiden 500er aus Nachtrag
131 — ein `require()` holte einen Namen, den es nicht gab, und der TypeError
flog synchron an jedem `.catch()` vorbei.

Als eigenes Modul ohne Rückbezug ist sie ein Blatt im Abhängigkeitsbaum:
`import` funktioniert, tsc prüft mit.
```

<a id="set-img-max-bytes"></a>
## `SET_IMG_MAX_BYTES`

```text
Obergrenze für das LOKAL gespeicherte Set-Bild.

── Warum 20 statt 5 MB (Nachtrag 47, Marcos Fund) ─────────────────────────
Dieselbe Zahl wie im Bild-Proxy (PROXY_CACHE_MAX_BYTES, routes/imgProxy.ts)
— und aus demselben Grund. Nachtrag 43 hatte nur die PROXY-Grenze angehoben;
DIESE hier blieb bei 5 MB stehen, und damit blieb Marcos Set weiter ohne
lokales Bild:

  • downloadSetImage() bricht über der Grenze ab und liefert null
  • damit bleibt sets.image_local leer
  • generateThumb() arbeitet auf der lokalen Datei — ohne sie keine Vorschau
  • also holen beide Clients das Bild weiterhin über /api/img-proxy

Genau das war zu beobachten: „Das Bild wird nach wie vor nicht auf dem
Server gespeichert und auch kein Thumbs-Image erstellt." Rebrickable liefert
für neuere Sets hochauflösende Bilder (das gemeldete wog 5'243 kB).

Beide Grenzen zusammen anheben — sonst repariert man den einen Weg und der
andere fällt weiterhin heraus.
```

<a id="bilduseragent"></a>
## `bildUserAgent`

```text
Der Ausweis, mit dem wir uns beim Bildserver melden.

── Marcos Vorgabe ──────────────────────────────────────────────────────────
„Nutze einen sauberen, eindeutigen User-Agent-Header. Fehlt der Header oder
sieht er nach Standard-Scrapern aus, schlägt die Cloudflare-Heuristik
deutlich schneller an."

Hier stand bisher eine vorgetäuschte Chrome-Kennung. Das ist die schlechteste
aller Möglichkeiten: Sie sagt nicht, wer wir sind, und ein Browser, der
tausende Bilder ohne die üblichen Begleitanfragen holt, fällt einer Heuristik
gerade dadurch auf. Eine ehrliche Produktkennung mit Version ist üblich, gut
erkennbar — und wenn jemand beim Betreiber nachfragen will, weiss er wen.

── Warum über eine Umgebungsvariable ───────────────────────────────────────
Ich kann von hier aus nicht ausprobieren, wie der echte Bildserver auf die
neue Kennung reagiert. Sollte er ausgerechnet Produktkennungen abweisen,
lässt sich mit IMG_USER_AGENT umschalten, ohne neu zu bauen.
```

<a id="downloadsetimage-nichtvorhanden"></a>
## `nichtVorhanden`

```text
Statuscode nennen (Nachtrag 50): „404 vom CDN" und „403 wegen
Bot-Erkennung" verlangen völlig verschiedene Massnahmen —
vorher waren beide dasselbe schweigende null.

── Und 404 ist KEIN Fehler ─────────────────────────────────

Marcos Protokoll nach einem Serverstart war voll davon:

    [set-img] 5010729-1: HTTP 404 vom Bildserver: …

Ein 404 heisst „dieses Set hat beim CDN kein Bild" — bei alten
Sets der Normalfall, und der Job behandelt ihn auch so: Er
vermerkt ihn als Fehlanzeige (image_misses) und versucht es
NICHT wieder. Etwas, das richtig laeuft und sich nie aendern
wird, als `error` zu melden macht das Protokoll unlesbar — und
damit die echten Fehler unsichtbar, die daneben stehen.

403 und 429 bleiben `error`: Dort ist etwas zu tun (Drosselung,
Bot-Erkennung), und genau diese Unterscheidung war der Grund,
den Statuscode ueberhaupt zu nennen.
```
