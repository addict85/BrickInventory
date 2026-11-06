# Begründungen zu `test/katalog-zug-entprellt.test.js`

Die ausführlichen Kommentare aus `test/katalog-zug-entprellt.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Ein Zug ueber die Jahres-Leiste holt EINE Seite, nicht hundert.

── Woher diese Datei kommt ─────────────────────────────────────────────────
Marcos Befund galt der App: „wenn ich im Katalog zu einem Jahr springe dauert
es einige Sekunden bis die Bilder angezeigt werden. wenn ich sonst scrolle
kommen sie fluessig." Dort lag der Abruf unmittelbar im Rueckruf der Leiste
und lief bei JEDEM Beruehrungspunkt; behoben ist er jetzt entprellt
(KatalogSprungEntprelltTest in der App).

Beim Nachziehen in die Webapp zeigte sich: Hier ist die Entprellung laengst
da (Nachtrag 96, `_catLadeTimer`). Nachgezogen wird deshalb nicht der Code,
sondern die REGEL — denn geprueft war bisher nur, dass die Zeile
`_catLadeTimer = setTimeout(tun, …)` im Quelltext vorkommt
(catalog-frontend.test.js). Das ist eine Aussage ueber den Text, nicht ueber
das Verhalten: Wer `tun()` zusaetzlich an anderer Stelle sofort aufruft oder
den Ladeweg am Timer vorbeifuehrt, laesst jene Pruefung gruen.

── Was hier gemessen wird ──────────────────────────────────────────────────
Der echte public/js/09-catalog.js in jsdom, mit einem Katalog aus 6000 Sets
(100 Seitenbloecke) und ECHTEN Blocklagen — jsdom rechnet kein Layout, also
liefert getBoundingClientRect() hier Koordinaten aus der Seitennummer. Ohne
das gilt jeder Block als sichtbar und die Messung waere wertlos.

Dann ein Zug ueber die ganze Leiste: 40 Rollschritte von oben nach unten.
Gezaehlt werden die /catalog/sets-Abrufe.

── Die Gegenprobe laeuft MIT ───────────────────────────────────────────────
Derselbe Zug ein zweites Mal, mit herausgenommener Ruhe (die eine Zeile
ersetzt durch den sofortigen Aufruf). Ohne sie hiesse „wenige Abrufe" nur,
dass der Pruefstand gar nichts ausloest — der haeufigste Weg, wie eine
Messung sich selbst bestaetigt.

Gemessen mit genau dieser Einstellung (40 Schritte, 50 Seitenbloecke): MIT
der Ruhe 2 Abrufe — die Seiten 49 und 50, also das Ziel und sein Nachbar im
Vorlauf. OHNE sie 48 Abrufe fuer 48 verschiedene Seiten, praktisch der ganze
Weg dorthin.

Die Zusicherungen unten lassen absichtlich Luft: Auf einem ausgelasteten
Laeufer kann zwischen zwei Rollschritten mehr Zeit vergehen als die Ruhe
lang ist, dann feuert der Timer schon waehrend des Zuges. Der ABSTAND
zwischen beiden Laeufen bleibt davon unberuehrt, weil beide im selben
Prozess unter denselben Bedingungen laufen — deshalb ist er die eigentliche
Zusicherung.

Der Katalog ist hier mit 50 Bloecken kleiner als in Wirklichkeit (rund 420).
Das ist eine Frage der Laufzeit, nicht der Aussage: Der Gegenprobe-Lauf baut
jede geholte Seite wirklich auf, und 420 Bloecke kosteten ein Vielfaches,
ohne dass der Unterschied deutlicher wuerde.
```
