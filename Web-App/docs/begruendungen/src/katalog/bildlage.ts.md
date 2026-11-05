# Begründungen zu `src/katalog/bildlage.ts`

Die ausführlichen Kommentare aus `src/katalog/bildlage.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="electprimaryworker-manualparts"></a>
## `manualParts`

```text
Manuell erfasste Teile mit fehlendem lokalen Bild — im selben Job
dauerhaft in den lokalen Cache laden (statt nur über den Proxy).

Ohne user_id, und das ist der Punkt: Das Bild haengt am Teil-Farb-Paar
und liegt seit Migration 0034 EINMAL im Katalog. Vorher stand diese
Abfrage auf parts und lieferte dasselbe Paar je Konto erneut — der
Job lud dieselbe Datei mehrfach herunter.

Der JOIN auf parts bleibt: Geladen werden nur Bilder von Teilen, die
jemand tatsaechlich manuell erfasst hat. Set-Teile deckt
downloadSetImages() oben ueber set_parts_catalog ab.
```

<a id="electprimaryworker-figstofetch"></a>
## `figsToFetch`

```text
Minifiguren — ALLE, nicht nur manuell erfasste.

Bisher stand hier `source='manual'`. Minifiguren aus Sets liefen
dadurch dauerhaft über /api/img-proxy: Anmeldeprüfung, Cache-Suche
und Stream bei jeder einzelnen Kachel, beim ersten Anzeigen dazu ein
CDN-Roundtrip je Bild. Set-Bilder liegen längst lokal und gehen über
express.static — deshalb war die Minifiguren-Ansicht spürbar träger.

Das DISTINCT ON ueber die Nummer stand hier, weil die Abfrage auf
minifigs lief und dieselbe Figur je Konto eine Zeile hatte. Seit
Migration 0034 steht Name und Bild EINMAL im Katalog, und
fig_number ist dort der Primaerschluessel — die Verdichtung erledigt
die Tabelle.

Das EXISTS haelt die Menge bei dem, was die Abfrage vorher lieferte:
Figuren, die jemand besitzt. Der Katalog kennt auch Figuren aus
Set-Teilelisten, die niemand hat.
```
