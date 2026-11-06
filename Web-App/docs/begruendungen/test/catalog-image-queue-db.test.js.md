# Begründungen zu `test/catalog-image-queue-db.test.js`

Die ausführlichen Kommentare aus `test/catalog-image-queue-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Katalog stösst nicht mehr Bilder an, als jemand ansieht.

── Marcos Meldung ──────────────────────────────────────────────────────────
„Die App scheint den Server seit der vorletzten Version sehr stark
auszulasten. Die CPU ist praktisch non-Stop auf 100 % Auslastung."

── Die Ursache, und warum sie erst jetzt auftrat ───────────────────────────
Die Katalogliste bereitet Bilder vor: Zu jedem Set ohne lokale Datei wird ein
Download eingereiht, und zu jedem Download gehört das Erzeugen eines
Vorschaubildes — das ist die teure Arbeit.

Bis zum Umbau der Liste holte die Webapp die Seiten EINE nach der anderen;
wer zehn Seiten weit scrollte, stiess zehn Seiten Bilder an. Seit dem
Fensterladen (Nachtrag 90) kann ein einziger Scroll-Vorgang viele Seiten
anfordern. Bei rund 25 000 Katalog-Sets lief der Server damit lange nach dem
Scrollen weiter auf Anschlag.

Begrenzt war die PARALLELITÄT (zwei gleichzeitig), nicht die WARTESCHLANGE.
Zwei gleichzeitige Downloads bei 25 000 Einträgen sind keine Schonung,
sondern nur eine lange Warteschlange.

── Gemessen ────────────────────────────────────────────────────────────────
Zehn Seiten in schneller Folge (600 Sets), Downloader abgefangen:

    ohne Deckel   600 Aufträge
    mit Deckel    104 Aufträge

Dieser Test misst dasselbe — an der ECHTEN Route, nicht an der Hilfsfunktion:
Genau dazwischen sass der Fehler, denn die Route reiht je Seite bis zu 60
Sets ein, und niemand begrenzte die Summe.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```

<a id="stelle"></a>
## `assert.equal(angestossen, 0,`

```text
── Aus dem Deckel wurde eine Null (Nachtrag 105) ─────────────────────

Der Deckel aus Nachtrag 95 begrenzte die Bildarbeit der Liste. Marcos
Zuordnung — „die CPU ist seit der Umstellung des Katalogs mit dem
Scrolling so stark ausgelastet" — führte dann auf den eigentlichen
Befund: Diese Warteschlange rief `generateThumb()` DIREKT auf, vorbei an
THUMB_MAX_PARALLEL und der Sitzungssperre im Bild-Proxy.

Sie ist ersatzlos entfallen. Der lokale Cache baut sich weiterhin auf,
nur über den anderen Weg: Bildanfrage über den Proxy → Notiz →
jobs/imageQueue.ts. EIN Erzeuger statt zweier, und dieser ist gedrosselt.
```
