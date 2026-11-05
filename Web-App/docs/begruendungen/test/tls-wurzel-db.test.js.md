# Begründungen zu `test/tls-wurzel-db.test.js`

Die ausführlichen Kommentare aus `test/tls-wurzel-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Wurzel der internen CA: Fingerabdruck (Base64 SHA-256 SPKI), /ca.crt,
die Anzeige in den Einstellungen, `fp` im QR-Code nur zu einer https-Adresse
und das Sitzungscookie nur über TLS.

Feste Testvektoren: test/fixtures/ca-wurzel-{1,2}.crt, Fingerabdrücke mit
openssl gerechnet (x509 -pubkey | pkey -pubin -outform der | dgst -sha256
-binary | base64), nicht mit dem Code unter Prüfung.
```
