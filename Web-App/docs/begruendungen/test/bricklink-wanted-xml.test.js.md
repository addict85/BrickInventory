# Begründungen zu `test/bricklink-wanted-xml.test.js`

Die ausführlichen Kommentare aus `test/bricklink-wanted-xml.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Wanted-Liste, die der Teileliste-Export zu BrickLink schickt.

── Woher dieser Test kommt ─────────────────────────────────────────────────

Marcos Hinweis vom 20.10.: „Den Export gibt es ja ebenfalls in der
Teileliste." Er hatte recht — ich hatte danebenher einen zweiten gebaut.
Beim Nachsehen im bestehenden (plExportBricklink in js/08-init.js) standen
drei Dinge, die erst BEI BRICKLINK auffallen und hier gar nichts anzeigen:

  1. Die Datei begann mit `<?xml version="1.0" encoding="UTF-8"?>`.
     BrickLinks Hilfe sagt wörtlich, ein Wanted-List-XML „can not have an
     XML declaration". Der LESER in js/18-wanted-xml.js verträgt beides —
     von dort stammte die Zeile.
  2. Keine Grössengrenze. BrickLink nimmt höchstens 204 800 Bytes je
     Upload und weist eine grössere Datei GANZ ab.
  3. Die Farbe fiel auf die REBRICKABLE-Nummer zurück:
         p.bl_color_id ?? _rbToBlColor[p.color_id] ?? p.color_id ?? 0
     Fehlte die Zuordnung, ging eine Rebrickable-Farbnummer als
     BrickLink-Farbnummer hinaus. Das ergibt eine gültige Datei, die das
     FALSCHE Teil bestellt — und das fällt erst auf, wenn das Paket da ist.
     Spiegelverkehrt derselbe Fehler, den der Import am 19.10. hatte
     (dort wurde `color_id: 0` erfunden, also Schwarz).

── Warum das Bauteil DOM-frei ist ──────────────────────────────────────────

js/08-init.js greift schon beim Laden auf das Dokument zu und lässt sich
deshalb hier nicht einlesen. Das Format steht darum in
js/19-bricklink-xml.js, das nur Daten kennt — eingelesen wie
test/bundle-smoke.test.js es mit js/01-api.js macht.

Was der AUFRUFER damit tut (welche Posten er weglässt und wie er das
meldet), prüft test/teileliste-bl-export.test.js am Quelltext.
```
