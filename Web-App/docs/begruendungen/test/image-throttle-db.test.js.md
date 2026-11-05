# Begründungen zu `test/image-throttle-db.test.js`

Die ausführlichen Kommentare aus `test/image-throttle-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine Drosselung des CDN ist KEINE Fehlanzeige.

── Marcos Frage ────────────────────────────────────────────────────────────
„Wie schätzt du den CDN ein, können so viele Requests abgefragt werden oder
wird da Cloudflare die IP sperren?"

Beim Nachsehen fiel ein Fehler auf, der ohne diese Frage unbemerkt geblieben
wäre: `downloadSetImage()` antwortet auf JEDEN Fehlschlag mit `null` — bei
404 („dieses Bild gibt es nicht") ebenso wie bei 403 („du fragst zu
schnell"). Der Hintergrund-Job leitete daraus eine Fehlanzeige ab und
sperrte das Bild für sieben Tage.

Bei einer Drosselung ist das genau falsch herum: Dann sind die Bilder
VORHANDEN, und ausgerechnet der Ansturm, der die Drosselung auslöst, hätte
hunderte davon dauerhaft ausgesperrt. Der Bild-Proxy unterscheidet die
beiden Fälle längst (nur 404 wird gemerkt) — dem Job fehlte die Auskunft.

── Was jetzt gilt ──────────────────────────────────────────────────────────
  404      → Fehlanzeige, nicht wieder versuchen
  403/429  → Pause, alle unbearbeiteten Notizen zurück in die Warteschlange

Gemessen, zehn Notizen:

    403:  0 abgearbeitet, 1 Versuch, 10 Notizen erhalten, 0 Fehlanzeigen
    404: 10 Versuche, 10 Fehlanzeigen

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="stelle"></a>
## `try { await db.initSchemaOnce(); }`

```text
── Marcos Log (Nachtrag 117) ─────────────────────────────────────────────
    [thumb] Vorschau fehlgeschlagen für /images/sets/5007579-1.jpg:
            Mime type image/webp does not support decoding
— und dieselbe Zeile für 5007576-1, 5007623-1, immer wieder.

Jimp kann webp nicht entpacken. In Nachtrag 104 habe ich das gemerkt, aber
nur im Bild-Proxy. Der JOB rief generateThumb() direkt auf und verschluckte
den Fehler. Also entstand keine Datei, beim nächsten Durchgang galt „Bild
da, Vorschau fehlt", und es wurde erneut versucht — nach jedem Klick auf
„Katalogbilder holen" wieder.

Auf einem Raspberry Pi ist ein vergeblicher Jimp-Lauf, der die Datei erst
einliest und dann aufgibt, genau die Arbeit, die niemand haben will.
```

<a id="stelle-2"></a>
## `assert.equal(e.gesamt, 0,`

```text
── Zurückgelegt ist NICHT bearbeitet (Nachtrag 122) ─────────────────

`erg.gesamt` stand auf `rows.length` — also auch dann auf zehn, wenn
der Stapel schon an der ERSTEN Zeile abbrach und alle zehn zurück in
die Warteschlange gingen. Im Log stand dann „10 bearbeitet: 0 geladen,
0 Vorschau erzeugt, 0 bereits vorhanden": eine Zeile, die behauptet,
etwas getan zu haben, und keinen Hinweis gibt, was.
```
