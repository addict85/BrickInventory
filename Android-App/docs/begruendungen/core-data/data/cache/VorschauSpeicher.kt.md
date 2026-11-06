# Begründungen zu `core-data/data/cache/VorschauSpeicher.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/data/cache/VorschauSpeicher.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="vorschauspeicher"></a>
## `VorschauSpeicher`

```text
Dauerhafte Ablage der Vorschaubilder — damit die Tabellen ohne Netz stehen.
Coils Plattencache und der HTTP-Cache liegen unter `cacheDir`, den Android
jederzeit leeren darf, und beide sind LRU: Wer durch den Katalog blättert,
verdrängt die eigene Sammlung. Diese Ablage liegt unter `filesDir` und räumt nur
selbst. Keine Datenbank: Der Schlüssel ist die Adresse, gefragt wird nur „habe
ich die?“. Zusammenzuführen gibt es nichts — die App liest Bilder nur, und ob
die Kopie stimmt, klärt der ETag im HTTP-Cache. Verschlüsselt wie der Bestand
(sec11 N1): Die Bilder zeigen, welche Sets jemand besitzt.
```

<a id="spekulativ-zeit"></a>
## `SPEKULATIV_ZEIT`

```text
Zeitstempel für spekulativ geholte Bilder, kurz nach der Epoche: Aufgeräumt wird
das Älteste zuerst, und ein vorgewärmtes Bild soll vor einem wirklich
angesehenen fliegen. Wird es später angesehen, schreibt der Abgriff in
NetzModule es mit `spekulativ = false` neu und gibt ihm einen echten Stempel.
Nicht 0, weil manche Dateisysteme die Null nicht annehmen. Die Grenze oben
ganzzahlig, weil `const val` nur Konstantenausdrücke verträgt.
```
