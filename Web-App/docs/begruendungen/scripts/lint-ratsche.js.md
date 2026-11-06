# Begründungen zu `scripts/lint-ratsche.js`

Die ausführlichen Kommentare aus `scripts/lint-ratsche.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Lint und Format als Ratsche: Biome (biome.json) findet im Bestand Hunderte
Stellen, die erst nach und nach aufgeräumt werden. Rot ist nur, was die
Zahl über die Schranke in scripts/lint-schranken.json hebt; sinkt sie, nennt
das Skript die neue Zahl zum Nachziehen.

  node scripts/lint-ratsche.js lint     Funde des Linters
  node scripts/lint-ratsche.js format   Dateien, die der Formatierer ändern würde
  LINT_SCHRANKEN=<datei>                andere Schrankendatei (für den Test)
```
