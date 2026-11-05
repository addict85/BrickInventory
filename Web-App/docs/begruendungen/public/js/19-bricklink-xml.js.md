# Begründungen zu `public/js/19-bricklink-xml.js`

Die ausführlichen Kommentare aus `public/js/19-bricklink-xml.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="die-gegenrichtung-zu-js-18-wanted-xml-js"></a>
## Die Gegenrichtung zu js/18-wanted-xml.js (das liest). Benutzt wird sie vom

```text
── BrickLink-Wanted-Listen SCHREIBEN ───────────────────────────────────────

Die Gegenrichtung zu js/18-wanted-xml.js (das liest). Benutzt wird sie vom
BrickLink-Knopf der Teileliste (plExportBricklink in js/08-init.js).

── Warum eine eigene, DOM-freie Datei ──────────────────────────────────────

Damit sie sich prüfen lässt. js/08-init.js greift schon beim Laden auf das
Dokument zu; ein Test kann sie deshalb nicht einfach einlesen. Diese Datei
kennt nur Daten und Zeichenketten — test/bricklink-wanted-xml.test.js
importiert sie unverändert, so wie test/bundle-smoke.test.js es mit
js/01-core.js macht.

── Die drei Stellen, an denen man dieses Format falsch macht ───────────────

Alle drei hatte der Export vom 20.10. falsch, und alle drei fallen erst bei
BrickLink auf — hier ist nichts zu sehen:

  1. Eine XML-Deklaration (`<?xml …?>`) ist VERBOTEN. BrickLinks Hilfe sagt
     wörtlich, ein Wanted-List-XML „can not have an XML declaration".
     Der Leser in js/18-wanted-xml.js verträgt beides, BrickLink nicht —
     und genau von dort stammte die Zeile.
  2. Höchstens 204 800 Bytes je Upload (BrickLink-Hilfe 207). Darüber wird
     die GANZE Datei abgewiesen, nicht der überzählige Teil.
  3. COLOR ist eine BRICKLINK-Farbnummer. Eine Rebrickable-Nummer dort
     hinzuschreiben ergibt eine gültige Datei mit der falschen Farbe —
     Marco bestellt dann rot, was blau sein sollte. Deshalb nimmt
     [baueWantedXml] `null` als „unbekannt" und schreibt KEIN COLOR;
     wer eine Nummer nicht hat, lässt den Posten besser weg und sagt es
     (siehe plExportBricklink).
```

<a id="bauewantedxmlstuecke"></a>
## `baueWantedXmlStuecke`

```text
Dieselbe Liste, in Stücke geschnitten, die BrickLink annimmt.

Gemessen wird in BYTES und nicht in Zeichen: Ein Teilename mit Umlaut wird
in UTF-8 zu mehr Bytes als er Zeichen hat, und die Grenze ist eine
Bytegrenze. `TextEncoder` statt `.length` ist hier tragend.

Ein einzelner Posten, der allein schon zu gross ist, lässt sich nicht
teilen; er bekommt sein eigenes Stück, und das ist dann eben zu gross. Das
zu verschweigen wäre schlimmer — BrickLink lehnt ab, und niemand wüsste,
woran es lag.
```
