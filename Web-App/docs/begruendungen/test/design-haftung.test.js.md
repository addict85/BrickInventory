# Begründungen zu `test/design-haftung.test.js`

Die ausführlichen Kommentare aus `test/design-haftung.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stelle"></a>
## `/**`

```text
Kopfleiste und Reiterleiste haften GEMEINSAM — oder gar nicht.

── Der Fehler, gegen den diese Pruefung gebaut ist ─────────────────────────

styles.css heftet die Kopfleiste mit `position:sticky;top:0` an den oberen
Rand und die Reiterleiste darunter mit `position:sticky;top:58px`. Die 58
sind keine freie Zahl: Es ist die Hoehe der Kopfleiste. Die beiden Leisten
sind ueber diese eine Zahl aneinander gebunden.

themes/noppe.css hat der Kopfleiste `position:relative` gegeben — nicht aus
gestalterischen Gruenden, sondern weil die Noppenreihe ein ::before mit
`position:absolute` ist und dafuer einen positionierten Vorfahren braucht.
Damit war die Kopfleiste nicht mehr angeheftet: Sie scrollte weg, die
Reiterleiste blieb auf 58px stehen und schob sich ueber den Inhalt. Marco
hat genau das gemeldet.

Das `relative` war dabei nicht einmal noetig — `sticky` ist selbst ein
positionierter Vorfahre.

── Warum die Regel PAARWEISE ist und nicht „nie anfassen" ──────────────────

Die erste Fassung dieser Pruefung verbot jedes `position` an einer
angehefteten Leiste. Sie war sofort rot — und zwar zu Recht ROT AN DER
FALSCHEN STELLE: themes/brick.css setzt Kopf- UND Reiterleiste auf
`position:static`, weil dort beide als mitscrollende Kacheln gedacht sind.
Das ist eine Gestaltungsentscheidung und kein Versehen; es geht auch nichts
kaputt, weil eben BEIDE mitscrollen.

Kaputt geht genau der gemischte Fall: eine Leiste haftet, die andere nicht.
Das ist die Regel, die hier steht.
```

<a id="ohnekommentare"></a>
## `const ohneKommentare = css => css.replace(/\/\*[\s\S]*?\*\//g, '');`

```text
Kommentare weg, bevor irgendetwas zerlegt wird.

Nicht kosmetisch: Ohne diesen Schritt haengt der Kommentarblock VOR einer
Regel am ersten Selektor, und aus `[data-theme="noppe"] header` wird
`/* … *\/\n[data-theme="noppe"] header`. Die Gegenprobe zu dieser Datei hat
genau das gezeigt — sie meldete nur den ZWEITEN der beiden Selektoren einer
Regel. Eine Verletzung in einer einselektorigen Regel mit Kommentar darueber
waere still durchgerutscht.
```
