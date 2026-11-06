# Begründungen zu `scripts/check-noimplicitany.js`

Die ausführlichen Kommentare aus `scripts/check-noimplicitany.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
noImplicitAny — gestaffelt, mit einer Liste, die nur kürzer werden darf.

── Warum es dieses Skript gibt (Nachtrag 150) ──────────────────────────────
`noImplicitAny` meldet noch 631 Stellen, 632 davon ursprünglich derselbe
Fall: ein Parameter ohne Typ (TS7006). Den Schalter einfach in tsconfig.json
einzuschalten hiesse, den Übersetzer dauerhaft rot zu machen — und ein
Übersetzer, der immer rot ist, wird nicht mehr gelesen. Genau diese
Begründung stand jahrelang zu Recht bei strictNullChecks.

── Warum keine zweite tsconfig ────────────────────────────────────────────
Der naheliegende Weg wäre eine `tsconfig.noimplicitany.json`, die die noch
unsauberen Dateien in `exclude` aufführt. Das funktioniert NICHT: `exclude`
bestimmt nur, welche Dateien als Einstiegspunkte gesucht werden. Was von
einer eingeschlossenen Datei importiert wird, landet trotzdem im Programm
und wird mitgeprüft — ausprobiert, es blieben 471 der 631 Meldungen übrig.

Deshalb hier ein Skript: Es lässt tsc über ALLES laufen und wertet aus, aus
welcher Datei eine Meldung kommt. Der Schalter ist damit für alle Dateien
ausser den unten aufgeführten scharf.

── Die Liste ist LEER, und damit hat dieses Skript eine neue Aufgabe ──────
Der Abbau ist durch: `noImplicitAny` steht seit dieser Etappe in
tsconfig.json auf `true`, `npx tsc --noEmit` ist also selbst die Prüfung.

Weshalb das Skript trotzdem bleibt: Den Schalter WIEDER AUSZUSCHALTEN macht
den Übersetzer GRÜNER, nicht röter. Das ist die eine Regression, die tsc
grundsätzlich nicht melden kann — es gäbe schlicht keine Meldung mehr. Also
prüft dieses Skript jetzt die Regel selbst: dass der Schalter an ist.

Die Ausnahmeliste bleibt als Mechanik stehen. Wer den nächsten Schalter
gestaffelt einführt (strictFunctionTypes, useUnknownInCatchVariables …),
findet hier das Gerüst und muss es nicht neu bauen.

── Die Richtung war der Punkt ─────────────────────────────────────────────
Die Liste war eine AUSNAHMELISTE, keine Auswahlliste. Eine neue Datei war
automatisch streng; Schuld liess sich nur abbauen, nicht mehr stillschweigend
anhäufen. Beim Aufräumen einer Datei fiel ihre Zeile weg, sonst nichts.

  npm run typecheck:strict

Geprüft wird zweierlei, und das Zweite ist das wichtigere:
  1. Keine Meldung aus einer Datei ausserhalb der Liste.
  2. Kein VERWAISTER Eintrag — eine Datei, die den Schalter längst bestünde
     oder die es nicht mehr gibt. Ohne diese Richtung wüchse hier eine
     Abschrift heran, die niemand mehr pflegt; genau daran ist in
     Nachtrag 149 die Namensraum-Liste gescheitert.
```

<a id="stelle"></a>
## `// Der Typ steht hier, seit die Liste LEER ist: 'new Set([])' ergibt s`

```text
Dateien, die `noImplicitAny` noch NICHT bestehen.

Diese Liste darf nur kürzer werden. Wer eine Datei aufräumt, streicht ihre
Zeile; wer eine neue Datei anlegt, kommt hier gar nicht erst vor.

Stand bei Einführung: 44 offen, 48 bereits sauber.
Nachtrag 151: noch 30 offen, 62 sauber.
Nachtrag 156: noch 24 offen.
Diese Etappe: LEER. Der Schalter steht in tsconfig.json.
```
