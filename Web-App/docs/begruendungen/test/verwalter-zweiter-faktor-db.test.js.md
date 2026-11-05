# Begründungen zu `test/verwalter-zweiter-faktor-db.test.js`

Die ausführlichen Kommentare aus `test/verwalter-zweiter-faktor-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Verwalterrechte verlangen einen zweiten Faktor: Ein Verwalter ohne TOTP und
ohne Passkey kommt nach der Anmeldung nur bis zu dessen Einrichtung (403
zweiter_faktor_pflicht), Anmeldung und /auth/me sagen es der Oberfläche.
Ein gewöhnliches Konto und ein App-Token (Scope `app`) eines Verwalters sind
nicht betroffen. Ein Passkey allein genügt nicht: Die Anmeldung mit Passwort
verlangt nur bei aktivem TOTP einen zweiten Faktor.
```
