# Begründungen zu `test/menue-sichten.test.js`

Die ausführlichen Kommentare aus `test/menue-sichten.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jede Sicht hinter dem Menü ist erreichbar — und jeder Eintrag führt irgendwohin.

── Woher diese Prüfung kommt ───────────────────────────────────────────────

Marcos Vorgabe vom 16.10.: „Gerne den Reiter Einstellungen mit den Punkten
belassen die nur der Administrator setzen kann, und die restlichen Seiten
oben Rechts hinter dem Benutzernamen als Aufklappbares Menu mit 3 -
anzeigen."

Damit gibt es in der Webapp zum ersten Mal Flächen, die KEIN Reiter
erreicht. Genau diese Sorte ist in der Android-App schon einmal unsichtbar
geworden: `Screen.Settings` stand dort im Navigationsgraphen und kam im
ganzen Baum genau einmal vor — in seiner eigenen Registrierung. Marco fand
die Einstellungen nicht, weil es keinen Weg dorthin gab; seither hält
ErreichbareRoutenTest das fest.

Hier ist die Lage dieselbe, nur in HTML: Eine `.tab`-Fläche ohne Eintrag im
Menü ist unsichtbar, ein Eintrag ohne Fläche tut beim Klick nichts, und ein
Eintrag ohne Lader zeigt eine leere Seite. Keines davon meldet der Browser.
```

<a id="html"></a>
## `const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), `

```text
index.html OHNE Kommentare.

GEMESSEN am 17.10.: Ein Erklaerkommentar INNERHALB der Menueklappe enthielt
die Zeichenfolge eines schliessenden div-Tags — und `eintragsTexte()`
schneidet die Klappe genau am ersten solchen Tag aus. Der Ausschnitt endete
damit im Kommentar, die Pruefung sah sieben Eintraege statt acht und blieb
GRUEN. Sie hat nicht falsch gemessen, sondern still weniger, und das ist
schlimmer: Ein roter Fall meldet sich, ein verkuerzter nicht.

Ironischerweise war es der Kommentar, der vor genau diesem Schnitt warnte.

Dieselbe Entscheidung wie in test/bedienelement-name.test.js und
test/dom-ids.test.js: Gesucht wird im MARKUP. Was ein Kommentar beschreibt,
ist keine Oberflaeche.
```

<a id="stelle"></a>
## `/**`

```text
── Nachtrag vom 17.10.: das Symbol, das zur Laufzeit verschwand ────────────

Marcos Meldung, mit Bildschirmfoto: „Bitte bei Profil-Einstellungen auch
noch ein Icon verwenden."

Im Markup stand es längst:

    <button … data-i18n="settings.group.profile">👤 Profil-Einstellungen</button>

Nur zählt der Text im Markup nichts: `data-i18n` ERSETZT den Inhalt beim
Übersetzen durch den Sprachtext, und `settings.group.profile` lautete
schlicht „Profil-Einstellungen". Alle sechs Nachbareinträge tragen ihr
Symbol IM Sprachtext ('🎟️ Gutscheine', '🔔 Preisalarme', …) — dieser eine
nicht. Sichtbar war also nie, was dasteht.

Dieselbe Falle wie bei `G('ubadge').textContent` (siehe
test/benutzername-menueknopf.test.js): Ein Markup, das beim Laden richtig
aussieht und beim ersten Zugriff überschrieben wird.

i18n.test.js fängt das NICHT — es vergleicht Deutsch gegen Englisch, nicht
Markup gegen Sprachtext. Beide Sprachen waren hier einträchtig symbollos.
```

<a id="sprachdatei"></a>
## `const SPRACHDATEI = {`

```text
Die Pfade AUSGESCHRIEBEN und nicht über `sprache + '.js'` zusammengesetzt.

test/eigenbruecken.test.js zählt Pfade mit variablem Segment gegen eine
Ratsche und sagt dazu: „Wo es geht, gehört der Pfad ausgeschrieben — ein
variables Segment nimmt dieser Prüfung die Sicht." Die Ratsche von 74 auf
75 zu drehen wäre hier das Falsche: Sie rückt nach, wenn das Ausschreiben
eine ZWEITE WAHRHEIT schüfe — bei Schleifen über die Migrationsdateien
etwa, wo eine ausgeschriebene Liste beim nächsten Zuwachs veraltet.

Hier gibt es genau zwei Sprachdateien, und `['de', 'en']` steht ohnehin
schon im Fall darunter. Ausgeschrieben kostet nichts und bringt etwas:
eigenbruecken prüft die beiden Pfade jetzt WIRKLICH, statt sie nur als
uneinsehbar zu zählen.

(Gemerkt hat das die Ratsche, nicht ich — sie schlug bei 75 an.)
```

<a id="css-stelle"></a>
## `const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), '`

```text
── Was dieser Fall einmal war, und was aus ihm geworden ist ────────────

Marcos Vorgabe vom 17.10., frueh: „Der Abmeldebutton sollte gleich gross
wie die restlichen Buttons sein oben rechts (gleich hoch)." Nachgerechnet
waren es drei Hoehen — ≈31,5 px (Abmelden), 24 px (Namensknopf),
≈20 px (Admin-Plakette). Sie bekamen eine gemeinsame.

Am selben Tag, spaeter: „Abmelden" zog in die Klappe und die
Admin-Plakette in den Namen. In der Reihe steht nur noch EIN Element.

„Gleich hoch" ist damit keine Beziehung mehr, die man pruefen koennte —
ein Element ist immer gleich hoch wie es selbst. Der Fall heisst deshalb
jetzt anders und sichert, was uebrig bleibt und weiterhin eine
Entscheidung ist: Die 28 px stehen als Wert da, der Namensknopf nimmt
sie, und sie stehen NICHT an `.btn-sm`.

Den Fall einfach zu loeschen waere die andere Moeglichkeit gewesen. Dann
haette niemand mehr gemerkt, wenn die Hoehe an `.btn-sm` wandert — und
genau das ist die Falle, gegen die er gebaut wurde.
```
