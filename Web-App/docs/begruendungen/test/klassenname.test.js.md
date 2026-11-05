# Begründungen zu `test/klassenname.test.js`

Die ausführlichen Kommentare aus `test/klassenname.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jeder Klassenname tut etwas — er gestaltet oder er ist ein Griff.

── Der Befund ──────────────────────────────────────────────────────────────

Dieselbe Fehlerklasse wie bei den Element-ids (dom-ids.test.js), nur eine
Ebene weiter: Ein `class="…"`, das kein Stylesheet kennt, sieht im Quelltext
nach Absicht aus und bewirkt nichts. Der Browser meldet nichts, die Seite
baut sich auf, und wer sie ansieht, kann nicht wissen, dass hier etwas
gemeint war.

NACHGEMESSEN: 161 Klassennamen stehen in Auszeichnung oder werden per
classList gesetzt, 600 sind in den Stylesheets definiert. SECHS trugen
keine Regel — fünf davon zu Recht:

  admin-only, parts-body, parts-list, pl-have-input, job-sched-input

Die sind GRIFFE: JavaScript sucht Elemente daran (querySelector,
classList.contains). Ein Griff braucht keine Regel, und ihn zu melden hiesse,
eine Prüfung mit fünf Fehlalarmen zu bauen — die wird abgeschaltet, nicht
befolgt.

Der sechste war `scope-select` an den vier Kontoauswahl-Feldern: kein
Stylesheet kannte ihn, kein JavaScript suchte danach. Die Breite stand
stattdessen viermal gleichlautend im style-Attribut. Jetzt trägt die Klasse
die Regel (styles.css), und die vier Inline-Angaben sind weg.

── Was der Test NICHT prüft ────────────────────────────────────────────────

Die Gegenrichtung — eine CSS-Regel, die niemand benutzt — bleibt offen. Sie
ist harmlos (ein paar Byte) und liesse sich nur mit einem echten Parser
beantworten: Regeln wie `.dt tr:hover td` oder `[data-theme] .sc` treffen
Elemente, die erst zur Laufzeit entstehen.

Zusammengesetzte Namen (`class="chip ${aktiv}"`) sieht er auch nicht; sie
tragen keinen festen Namen. Beides ist bewusst offen gelassen — die eine
Frage, die hier zählt, ist: Kann dieser Name überhaupt etwas bewirken?
```
