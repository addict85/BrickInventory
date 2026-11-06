# Begründungen zu `test/sitzung-beruehrung-db.test.js`

Die ausführlichen Kommentare aus `test/sitzung-beruehrung-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Ablaufzeit der Sitzung wird gedrosselt geschrieben.

── Was gemessen wurde ──────────────────────────────────────────────────────
Zwanzig Anfragen mit Sitzungs-Cookie, Abfragen am Verbindungs-Pool gezählt:

    vorher   20x SELECT sess FROM user_sessions …     2,0 je Anfrage
             20x UPDATE user_sessions SET expire = …
    nachher  20x SELECT   +   1x UPDATE               1,1 je Anfrage

Das gilt für JEDE Anfrage der Webapp, auch für jedes einzelne Bild einer
Galerie: Bei sechzig Kacheln waren das hundertzwanzig Abfragen allein für
die Sitzung, davon sechzig SCHREIBEND auf eine Tabelle, die sich alle
Cluster-Worker teilen.

Die Begründung, warum das Schreiben warten darf (und das Lesen nicht),
steht in src/konto/sitzungsBeruehrung.ts.

── Warum der Test die Sitzung auch BENUTZT ─────────────────────────────────
Eine Drosselung, die zu viel drosselt, sieht in der Zählung besser aus und
ist kaputt: Wird gar nicht mehr geschrieben, läuft jede Sitzung nach einem
Tag ab, egal wie aktiv jemand ist. Deshalb drei Zusicherungen statt einer —
die Zahl der Schreibvorgänge, das Fortbestehen der Sitzung UND dass die
Ablaufzeit überhaupt einmal geschrieben wird.

Voraussetzung: Test-DB (Inhalt wird angefasst!) via TEST_DATABASE_URL.
Ohne DB: skip. Ausführen: REQUIRE_DB=1 npm test
```
