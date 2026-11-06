# Begründungen zu `test/workflow-signatur.test.js`

Die ausführlichen Kommentare aus `test/workflow-signatur.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
docker-publish.yml signiert genau das Manifest, das der Push erzeugt hat:
Der Digest kommt aus der Ausgabe von `imagetools create`, nicht aus einer
späteren Auflösung des Tags. Hier laufen die echten Skripte der Schritte
`manifest` und `signatur` in bash; `docker` und `cosign` sind Ersatz. Der
docker-Ersatz meldet beim Auflösen des Tags einen ANDEREN Digest, als hätte
jemand den Tag zwischen Push und Signatur umgehängt.
```
