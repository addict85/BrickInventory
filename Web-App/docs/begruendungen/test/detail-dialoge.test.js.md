# Begründungen zu `test/detail-dialoge.test.js`

Die ausführlichen Kommentare aus `test/detail-dialoge.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Fusszeilen der vier Detail-Dialoge — was dort steht und wie gross es ist.

── Marcos Meldungen ────────────────────────────────────────────────────────

  „Der Papierkorb im Detaildialog der Teile ist kleiner als auf den anderen
   Detaildialogen." — dasselbe noch einmal fuer die Minifiguren.
  „Im Detaildialog der Sets sollen die Button Auf BrickLink kaufen und
   Preisvergleich nicht angezeigt werden."
  „Der Detaildialog der Teile hat ein zurueck Button diesen bitte
   entfernen." — dasselbe noch einmal fuer die Minifiguren.

── Warum das eine Regel wert ist ───────────────────────────────────────────

Alle drei Befunde sind Abweichungen, die NACHGEMESSEN wurden und die man
beim Lesen des Markups nicht sieht:

  * `btn-sm` neben `btn bd` macht aus 53x38px ein kleineres Feld
    (styles.css: .btn 9px/17px, .btn-sm 5px/11px). Der Unterschied faellt
    nur auf, wenn man zwei Dialoge NEBENEINANDER haelt — genau das tut
    dieser Test.
  * Ein Knopf, den man aus einem Dialog entfernt, kommt beim naechsten
    „analog zum Set-Detail" gern zurueck.

Teile und Minifiguren teilen sich EINEN Dialog (#man-detail-modal). Marcos
zwei Meldungen sind deshalb ein Fund, nicht zwei — und eine Regel.
```

<a id="jeder-detail-bildschirm-der-app-traegt-d"></a>
## `test('jeder Detail-Bildschirm der App traegt den Papierkorb in der Kop`

```text
Dieselbe Regel fuer die App — die Detail-Bildschirme tragen den Papierkorb
an derselben Stelle.

── Warum das hier steht und nicht in Kotlin ────────────────────────────────

Weil die Regel BEIDE Oberflaechen meint. Ein Kotlin-Test kennt die Webapp
nicht, und zwei getrennte Tests haetten genau den Fehler gemacht, den sie
verhindern sollen: Jeder haette fuer sich recht behalten, waehrend die
Oberflaechen auseinanderlaufen. Der Baum prueft Kotlin-Quelltext an
mehreren Stellen von hier aus (app-compose-importe.test.js,
catalog-local-images.test.js) — das ist die vorhandene Bauart, keine neue.

In der App ist die Abweichung eine andere als in der Webapp: Nicht die
GROESSE lief auseinander (alle drei benutzen IconButton mit der
Vorgabegroesse), sondern der ORT. Das Merkposten-Detail hatte als einziges
keinen Papierkorb in der Kopfleiste, sondern einen Textknopf ganz unten.

`ohneKommentare()` ist hier nicht Zierde, sondern die Regel selbst: Ohne
das Abstreifen haette der erste Versuch dieses Tests einen
AUSKOMMENTIERTEN Papierkorb als vorhanden gezaehlt — die Gegenprobe blieb
gruen, und genau daran ist sie aufgefallen. Der Helfer traegt dieselbe
Warnung im Kopf; sie hat sich hier zum wiederholten Mal bewahrheitet.
```

<a id="titel-und-fussleiste-kleben-und-koennen"></a>
## `test('Titel- und Fussleiste kleben — und koennen das auch', () => {`

```text
Titel- und Fussleiste der Dialoge bleiben beim Rollen stehen.

── Marcos Wunsch ───────────────────────────────────────────────────────────

„Kannst du bei den Detail-Dialogen in der Webapp dafuer sorgen, dass der
exemplarisch rot markierte Teil jeweils immer sichtbar ist auch wenn nach
unten gescrollt wird? Ebenso der Papierkorb ganz zu unterst. Dies bitte bei
allen Detail-Dialogen so umsetzen (auch bei den Teilen, Minifiguren,
Katalog, etc.)" — und nachgereicht: „Es soll wie ein Windows-Dialog wirken
(X ganz oben rechts)."

── Was hier geprueft wird, und was NICHT ───────────────────────────────────

NICHT das Aussehen: Ob die Leiste wirklich oben klebt, entscheidet das
Layout, und node rechnet keines. Das wurde in Chromium 142 gemessen
(playwright-core, echte tokens.css + styles.css + mobile.css, echtes Markup
aus index.html, Inhalt bis zum Ueberlaufen aufgefuellt, dann ans Ende
gerollt). Abstand der Leisten vom Rand des Rollfensters:

                     Kopf oben   links   rechts   Fuss unten
  Set                      0px     0px      0px          0px
  Katalog                  0px     0px      0px          0px
  Teile/Figuren            0px     0px      0px        0,4px
  Teil im Set              0px     0px      0px        0,4px
  Merkposten               0px     0px      0px          0px
  Erfassungen              0px     0px      0px        0,4px
  Set (Handy 390px)        0px     0px      0px          0px
  Teile/Figuren (Handy)    0px     0px      0px          0px

Die erste Fassung mass dort 28px statt 0 — `position:sticky` rechnet seinen
Versatz vom INHALTSKASTEN des Rollbereichs, nicht von dessen Sichtfenster,
und 28px sind genau die Polsterung des Dialogs. Deshalb der negative
Versatz in styles.css. Dieselbe Stelle stand in mobile.css schon einmal mit
`top:0` da — die Leiste klebte dort 1,1rem zu tief, ohne dass es auffiel.

GEPRUEFT wird hier die VORAUSSETZUNG, und die ist die eigentliche Falle:
`position:sticky` wirkt nur, wenn das Element ein direktes Kind des
Rollbereichs ist. Wickelt jemand den Rumpf eines Dialogs in ein weiteres
<div> — der naheliegendste Handgriff der Welt —, hoert die Leiste
stillschweigend auf zu kleben. Kein Fehler, keine Warnung, nichts im Test.
```
