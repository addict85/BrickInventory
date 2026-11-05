# Begründungen zu `test/email-neu-db.test.js`

Die ausführlichen Kommentare aus `test/email-neu-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine neue E-Mail-Adresse gilt erst nach dem Link an sie (Sicherheitsprüfung
Runde 12, N1). Bis dahin bleibt die alte, und die neue belegt nichts: Ihr
Inhaber kann sich mit ihr registrieren, und Passwort-vergessen findet über
eine unbestätigte Adresse kein Konto. Seit Runde 13 (N1) legt auch eine
Registrierung ihre Adresse nur als ausstehend ab; die erste Bestätigung
gewinnt. Migration 0096 macht aus dem Altbestand ausstehende Adressen (H5),
0097 ebenso aus offenen Registrierungen, und der Start meldet die ohne Link.
```
