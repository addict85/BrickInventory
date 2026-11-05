# Begründungen zu `test/jobs-typescript.test.js`

Die ausführlichen Kommentare aus `test/jobs-typescript.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
jobs/ nach TypeScript (Punkt 10).

Neun Dateien, darunter die beiden grossen CSV-Importer — also genau der Code,
der am meisten mit Fremddaten hantiert. `checkJs` prüfte sie schon vorher;
die Umstellung hat trotzdem zwei echte Befunde geliefert:

  • jobs/priceJob.ts definierte `getGlobalSetting` ZWEIMAL. Die zweite
    Definition überschrieb die erste stillschweigend.
  • Das Build-Skript kannte `jobs/` nicht (`SRC_DIRS = ['db','utils','routes']`).
    Ohne Anpassung wären keine .js-Dateien entstanden und jedes
    require('./jobs/...') zur Laufzeit ins Leere gelaufen.
```

<a id="dist-jobs"></a>
## `const DIST_JOBS = path.join(ROOT, 'dist', 'jobs');`

```text
Fängt Tippfehler in Exportnamen und zirkuläre Importe ab, die der
Typecheck nicht sieht.

Geladen wird aus dist/ — die transpilierten .js liegen seit der
Build-Umstellung nicht mehr neben den .ts. Vorher iterierte diese Schleife
über jobs/*.js; ohne dist/ wären das null Dateien und der Test würde
stillschweigend nichts mehr prüfen. Deshalb: fehlt der Build, ist der Test
ROT statt grün-durch-Abwesenheit.
```

<a id="src-stelle"></a>
## `const src = fs.readFileSync(path.join(JOBS, 'priceJob.ts'), 'utf8');`

```text
Ursprung: getGlobalSetting stand ZWEIMAL in dieser Datei, die zweite
Definition überschrieb die erste stillschweigend. Inzwischen steht gar
keine mehr dort — beide Helfer kommen aus src/einstellungen/settings.ts.

Die Prüfung bleibt, weil der Rückfall derselbe wäre: Wer sich hier wieder
eine eigene Fassung schreibt, hat eine zweite Wahrheit über dieselbe
Tabelle, und die beiden können auseinanderlaufen (die alte Kopie nahm den
Ersatzwert schon beim LEEREN Eintrag, die zentrale erst bei NULL).
```
