# Begründungen zu `scripts/abdeckung.js`

Die ausführlichen Kommentare aus `scripts/abdeckung.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Abdeckung aus den V8-Dateien eines Testlaufs (test-lauf.js --abdeckung):
Server aus dist/, Oberfläche über die Sourcemap des Mess-Bündels bis in
public/js/. Eigene Auswertung statt `c8 report`: c8 verwarf die Funktionen
der Oberfläche beim Umschreiben der Sourcemap-Pfade (alles 100 %, 0 Funktionen).

  node scripts/abdeckung.js bericht   coverage/v8 → coverage/lcov.info, coverage-summary.json, bereiche.json
  node scripts/abdeckung.js pruefen   Bereiche gegen scripts/abdeckung-schranken.json
```
