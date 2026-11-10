# Begründungen zu `test/img-proxy-v1.test.js`

Die ausführlichen Kommentare aus `test/img-proxy-v1.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Bild-Proxy ist nach /api/v1 gezogen — überall, auch in den Daten.

── Der Befund (Nachtrag 162) ───────────────────────────────────────────────

Auf die Frage „läuft jetzt alles unter v1?" antwortete der Baum „ja". Die
Prüfung dazu las `app.get('/api/…')` aber NUR in server.ts, und diese Route
wird in routes/imgProxy.ts angemeldet (registerImgProxy). Sie war damit die
letzte Adresse neben /api/v1.

── Warum der Umzug mehr ist als eine geänderte Zeichenkette ────────────────

Diese Adresse wird GESPEICHERT, nicht nur gerufen: src/katalog/bilder/images.ts baut sie
in `image_url`, und die Werte stehen so in den Tabellen. Ein Umzug, der nur
die bauende Stelle anfasst, hinterlässt zwei Formen in derselben Spalte —
genau die Bauart, gegen die dieser Baum sonst prüft. Deshalb gehört
db/migrations/0014-img-proxy-nach-v1.sql dazu.

── Und warum die alte Adresse trotzdem bedient bleibt ──────────────────────

Installierte App-Fassungen bauen sie SELBST zusammen (ImageUrls.kt). Wer
nicht aktualisiert, bekäme sonst überhaupt keine Teilebilder mehr. Sie ist
eine Auslauf-Adresse, kein zweiter gleichrangiger Weg — und der Unterschied
ist genau das, was dieser Test festhält: BEIDE werden bedient, aber nur die
neue wird GEBAUT.
```

<a id="tabellen"></a>
## `const tabellen = ['sets', 'set_catalog', 'set_parts_catalog', 'set_min`

```text
Die Tabellenliste wird aus dem Schema GELESEN, nicht abgeschrieben: Eine
achte Tabelle mit image_url soll auffallen, nicht durchrutschen.
Die Tabellen mit image_url, die es VOR 0014 gab — abgelesen aus dem
früheren db/schema.sql, als es durch db/basis.sql ersetzt wurde. 0014 ist
abgeschlossen; die Liste ändert sich nicht mehr (einige Spalten sind
später in die Kataloge gewandert).
```

<a id="umgeschrieben"></a>
## `const umgeschrieben = [...mig.matchAll(/UPDATE\s+(\w+)\s/g)].map(m => `

```text
── Tabellen, die es bei Migration 0014 noch nicht gab ──────────────────

Die Liste oben nennt nur Tabellen von vor 0014. Neun Tabellen stehen nur in ihrer
Migration, und drei davon tragen image_url: part_catalog gibt es nicht,
aber part_color_catalog und minifigs_catalog (Migration 0034).

Migration 0014 KANN sie nicht anfassen — sie laeuft zwanzig Dateien
vorher. Die Zusage muss hier also anders lauten, und sie ist genauso
pruefbar: Ihre Adressen kommen aus Tabellen, die 0014 umschreibt. Steht
dort die neue Form, steht sie auch hier.

Geprueft wird genau das — nicht angenommen: Fuer jede solche Tabelle muss
die Migration, die sie anlegt, ihre image_url aus einer Tabelle lesen, die
0014 umschreibt.
```
