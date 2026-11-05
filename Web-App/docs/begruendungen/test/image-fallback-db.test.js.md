# Begründungen zu `test/image-fallback-db.test.js`

Die ausführlichen Kommentare aus `test/image-fallback-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stelle"></a>
## `await haeltSet(db, uid, OHNE, 1);`

```text
── Was Migration 0033 an diesem Aufbau geaendert hat ──────────────────

Vorher gab es ZWEI Orte fuer die Bildadresse: die eigene sets-Zeile und
den Katalog. Der Test stellte beide Faelle her — Zeile leer (der Katalog
muss einspringen) und Zeile gefuellt (sie darf nicht ueberschrieben
werden). Genau diesen Rueckfall gibt es nicht mehr: Die Adresse steht nur
im Katalog.

Geblieben ist die Aussage, auf die es Marco ankam („wenn das Bild lokal
noch nicht vorhanden ist, soll es direkt via Proxy vom CDN geholt
werden"): Ein Set ohne lokale Datei muss die CDN-Adresse mitliefern.
```
