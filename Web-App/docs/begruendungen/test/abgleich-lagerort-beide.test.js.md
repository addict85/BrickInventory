# Begründungen zu `test/lagerort-beide.test.js`

Die ausführlichen Kommentare aus `test/lagerort-beide.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Lagerort — dieselbe Antwort in beiden Oberflächen.

Wie test/bauabgleich-beide.test.js und aus demselben Grund: Marcos stehende
Vorgabe ist „zwei saubere Apps, in den Oberflächen einheitliche Ansichten,
ansonsten identische Funktion". Eine Erweiterung, die nur in der Webapp
landet, verletzt sie — und das fällt erst auf, wenn jemand am Telefon danach
sucht.

Geprüft wird die NAHT. Ob die Zahlen stimmen, beantwortet
test/lagerort-db.test.js gegen echte Daten.
```

<a id="kt-einst"></a>
## `const KT_EINST  = lies(path.join(__dirname, '..', '..', 'Android-App',`

```text
Die Einstellungen der App liegen in mehreren Dateien: Der Bildschirm
selbst traegt nur die Liste, jede Rubrik hat ihre eigene Seite
(EinstellungenUnterseiten.kt) mit der Karte in Einstellungen*.kt. Gelesen
werden deshalb alle, die es betrifft — die
Zusicherung lautet „die App tut das in ihren Einstellungen" und nicht
„in dieser Datei".
```
