# Begründungen zu `test/zweiter-faktor-gnadenfrist-db.test.js`

Die ausführlichen Kommentare aus `test/zweiter-faktor-gnadenfrist-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Gnadenfrist beim Einrichten des zweiten Faktors: Ein Verwalter ohne Faktor
(dort erzwingt ihn der Server), der sich eben mit dem Passwort angemeldet
(oder es gewechselt) hat, richtet ohne erneute Eingabe ein — einmal,
höchstens fünf Minuten lang, nur mit Sitzung. Jedes andere Konto nennt das Passwort. Ohne Frist und
ohne Passwort kommt `aktuelles_passwort_erforderlich`, ohne dass die Bremse
zählt; mit Passwort bleibt alles wie bisher.
```
