# Begründungen zu `test/tab-layout.test.js`

Die ausführlichen Kommentare aus `test/tab-layout.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Reihenfolge der Reiter-Bereiche: Erfassen → Suche/Filter → Liste.

── Woher dieser Test kommt (Nachtrag 32) ───────────────────────────────────
Marcos Wunsch aus dem Betrieb: Die Filter-Bedienelemente sollen NACH der
Erfassung stehen, nicht im Kopf des Reiters — sie stehen damit direkt über
der Liste, auf die sie wirken. Gilt für Galerie, Teile und Minifiguren;
Finanzen ausdrücklich nicht (dort gibt es keine Erfassen-Box), Teileliste
hat keine Filter, der Katalog keine Erfassung.

Der Test prüft die REIHENFOLGE im Markup, nicht Pixel: Erfassen-Formular
vor Filterleiste vor Listencontainer. Zusätzlich: Jede Bedienelement-ID
genau einmal — die IDs sind der Vertrag mit dem JS, ein verschobenes
Duplikat würde die Handler an das falsche Element binden.
```

<a id="leisten"></a>
## `const leisten = [...html.matchAll(/class="[^"]*\bfilterzeile\b[^"]*"/g`

```text
Marcos Wunsch: „Der Zwischenraum sollte grösser sein, damit es schön
aussieht." Gemeinsamer Wert für alle fünf Filterleisten — 1rem war zu eng.

Die fünfte ist die Merkliste (24.09.). Diese Regel hat sie prompt
gemeldet: Sie stand auf 1rem, also genau auf dem Wert, den Marco
verworfen hat — eine neue Leiste, die den alten Fehler wiederholt, ist
der Fall, für den eine Zahl hier überhaupt steht.
Seit dem 28.10. trägt jede Leiste die Klasse .filterzeile statt eines
Inline-Stils; der Abstand steht an genau einer Stelle in styles.css.
```

<a id="der-eigene-bestand-steht-nicht-in-der-we"></a>
## `test('der eigene Bestand steht nicht in der Werkzeugzeile der Teilelis`

```text
Der eigene Bestand steht in der Teileliste auf einer EIGENEN Zeile.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

„Bitte die rot umkreisten Buttons auf eine neue Zeile verschieben. Diese
gehören thematisch nicht zum Rest." Gemeint waren „Eigenen Bestand
eintragen" und „nur lose Teile".

Er hat recht, und die erste Zeile sagt jetzt auch, warum: Dort steht das
ZUSAMMENSTELLEN der Liste (Set-Nr., Hinzufügen, Erstellen) und das
WEITERGEBEN (PDF, BrickLink, Reset). Der eigene Bestand ist keines von
beidem — er trägt Zahlen IN die fertige Liste ein.

── Warum eine Regel und nicht nur die Änderung ─────────────────────────────

Die erste Zeile trägt `flex-wrap:nowrap` und einen waagerechten Rollbalken.
Ein Knopf, der dort wieder hineinrutscht, faellt nicht auf — er schiebt
bloss den Rest aus dem Bild. Genau so ist die Vermischung ueberhaupt
entstanden.

NACHGEMESSEN (Chromium, 1440px): Werkzeugzeile auf y=486, Bestand-Zeile auf
y=524 — zwei Zeilen, 8px Abstand. Ohne erzeugte Liste ist der Kopf 72px
statt 108px hoch, es bleibt also KEIN leerer Streifen stehen.
```
