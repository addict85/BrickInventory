# Begründungen zu `test/ca-eigene-wurzel.test.js`

Die ausführlichen Kommentare aus `test/ca-eigene-wurzel.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die eigene Wurzel-CA (scripts/ca-einrichten.sh) gilt nur für BRICK_HOST,
ihr Schlüssel bleibt nicht liegen, und Caddy signiert mit der Zwischenstelle
nur, wenn ./caddy/ca eingerichtet ist; ohne startet Caddy nur mit
BRICK_TLS=acme oder ausdrücklich mit CA_OHNE_NAMENSBESCHRAENKUNG=ja.
Geprüft mit openssl an echten Zertifikaten, das Startskript aus compose.yaml
läuft wirklich (sh, Pfade umgebogen). Ist ein Caddy da (CADDY_BIN oder
`caddy` im Pfad), startet er mit dem echten Caddyfile, und ein TLS-Client
prüft Kette und Wurzel; ohne Caddy wird nur dieser Teil übersprungen.
```
