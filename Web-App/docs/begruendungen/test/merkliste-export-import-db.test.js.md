# Begründungen zu `test/merkliste-export-import-db.test.js`

Die ausführlichen Kommentare aus `test/merkliste-export-import-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Merkliste geht als CSV hinaus und kommt als Merkliste zurück.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

  „Merklisten sollen ebenfalls analog den anderen Seiten exportiert und
   importiert werden können."

── Was hier LÄUFT und nicht gelesen wird ───────────────────────────────────

Der Rundlauf geht über die echten Adressen: Der Export über
GET /api/v1/settings/export/data (das ZIP, in dem auch sets.csv, teile.csv
und minifiguren.csv liegen), der Import über
POST /api/v1/wanted/import/csv. Dazwischen wird die Tabelle GELEERT — ohne
das wäre ein Import, der gar nichts tut, nicht von einem erfolgreichen zu
unterscheiden.

Genau diese Form hat in diesem Baum zwei Fehler gefangen, die eine
Quelltextprüfung durchgelassen hätte (siehe
test/verdrahtung-laeuft-db.test.js).

── Warum das ZIP wirklich entpackt wird ────────────────────────────────────

Es wäre einfacher, buildMerklisteCsv() direkt zu rufen. Dann bliebe aber
ungeprüft, was Marco verlangt hat: dass die Datei IM ARCHIV liegt. Ein
`archive.append`, das jemand entfernt, fiele sonst niemandem auf.
```

<a id="einlesen"></a>
## `const einlesen = async () => {`

```text
Die Gegenrichtung zu Fall 3: Der Import muss auch auf eine GEFUELLTE
Liste anwendbar sein. Ohne diesen Fall waere ein Import „richtig", der
nur auf der leeren Tabelle funktioniert.

Eigene Datei (csvAusPosten) und eigene Vorbedingung — beides aus
derselben Lehre: Las dieser Fall `csvText` aus Fall 1 und verliess sich
auf die von Fall 3 gefuellte Tabelle, wurde er bei JEDER Stoerung im
Export mit rot, ohne selbst etwas gefunden zu haben.
```
