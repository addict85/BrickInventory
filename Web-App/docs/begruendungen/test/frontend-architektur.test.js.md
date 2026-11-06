# Begründungen zu `test/frontend-architektur.test.js`

Die ausführlichen Kommentare aus `test/frontend-architektur.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Aufbau des Frontends: kein Importkreis, kein API-Aufruf an der Hülle vorbei.

Der Importgraph kommt vom Bündler selbst (esbuild --metafile), nicht aus
einem Muster über den Quelltext: Was esbuild auflöst, wird ausgeliefert —
auch ein dynamisches import(). Ein Kreis darin hiesse, dass die
Auswertungsreihenfolge vom Einstieg abhängt und ein `const` des anderen
Moduls beim Laden noch nicht steht. Rückwege nach oben laufen über
00-ereignisse.js (melde/abonniere) oder 00-ziele.js (springe).
```
