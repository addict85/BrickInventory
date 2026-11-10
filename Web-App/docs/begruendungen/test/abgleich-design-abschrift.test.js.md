# Begründungen zu `test/design-abschrift.test.js`

Die ausführlichen Kommentare aus `test/design-abschrift.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Farben, die BEIDE Oberflaechen gleich fuehren muessen, stehen EINMAL.

── Der Befund ──────────────────────────────────────────────────────────────

Beide Oberflaechen sollen gleich aussehen; das ist Marcos stehende Vorgabe.
Technisch geht das nicht ueber eine gemeinsame Datei: Das Web liest
CSS-Custom-Properties, die App braucht Compose-Farben. Derselbe Wert, zwei
Sprachen.

Also stand er zweimal da. Nachgezaehlt: 46 Farben in Theme.kt, und genau
VIER Zeilen nannten ueberhaupt, woher ihr Wert stammt. Der Rest war eine
stille Abschrift — und eine stille Abschrift laeuft irgendwann weg, ohne
dass ein Test rot wird. Dieselbe Fehlerklasse, wegen der es
shared/setnummer-korpus.json gibt (siehe shared/README.md).

Jetzt steht der Wert einmal, in shared/design-tokens.json, und beide Seiten
werden daraus erzeugt: public/tokens.css und ui/theme/DesignTokens.kt.

── Was hier NICHT mehr steht, und warum ────────────────────────────────────

Die erste Fassung dieser Datei verglich zwoelf Paare "Kotlin-Konstante gegen
CSS-Token" einzeln. Diese Pruefung ist mit der Erzeugung UEBERFLUESSIG
geworden: Beide Werte kommen jetzt aus derselben Zeile derselben Datei, sie
KOENNEN nicht mehr auseinanderlaufen. Eine Zusicherung, die nicht mehr
fehlschlagen kann, ist keine Absicherung, sondern Zierrat — und sie
verdeckt, wo die echte Gefahr jetzt liegt. Sie ist deshalb ersetzt, nicht
ergaenzt.

Die echte Gefahr ist neu und liegt woanders:

  1. Jemand aendert eine erzeugte Datei von Hand. Dann steht der Wert wieder
     zweimal, und beim naechsten `npm run build` ist die Aenderung weg.
  2. Jemand definiert einen erzeugten Token in einem handgeschriebenen
     Stylesheet NEU. Dann gewinnt dort das handgeschriebene, die App folgt
     aber weiter der gemeinsamen Quelle — genau das Auseinanderlaufen, gegen
     das der ganze Umbau gebaut ist, nur eine Ebene hoeher.
  3. index.html laedt tokens.css nicht mehr. Dann faellt im Web JEDE dieser
     Farben aus, und `var(--b600)` liefert nichts.

Gegen alle drei steht je eine Pruefung unten. Die vierte Pruefung
("Herkunftsangabe") bleibt aus der ersten Fassung: Sie gilt den Farben, die
WEITERHIN von Hand in Theme.kt stehen und kein Gegenstueck im Web haben.

── Was bewusst NICHT gemeinsam ist ─────────────────────────────────────────

Compose fuehrt mit background/surface/surfaceVariant drei Ebenen, wo das Web
mit --bg/--sur zwei fuehrt; die dritte muss sich unterscheiden, sonst
verschwinden Flaechen, die darauf liegen. Und im Stein-Design hat das Web
eine "Grundplatte" hinter der Seite, die die App gar nicht hat. Solche Werte
gehoeren nicht in die gemeinsame Quelle — shared/README.md sagt es
ausdruecklich: Ein Fall, der nur auf einer Seite gelten kann, gehoert nicht
dorthin.

── Warum diese Pruefung im WEB-Baum liegt ──────────────────────────────────

Sie muss laufen, sobald sich EINE der beiden Seiten aendert. Der
Android-Ablauf hat einen Pfadfilter, der Web-Ablauf hat keinen — er laeuft
bei jedem Push.
```

<a id="tokentabelle"></a>
## `function tokenTabelle(datei) {`

```text
`--name: #wert` aus einer CSS-Datei lesen und `var(--x)` einmal aufloesen.

Kommentare ZUERST weg — sonst liest die Suche die Erklaerung statt der
Regel. Genau das ist beim Anlegen passiert: In themes/brick.css stand im
Kommentar "Vorher stand hier --chart-used:#3d5a80", und die erste Fassung
nahm diesen ALTEN Wert fuer den gueltigen. Dieselbe Falle, wegen der es
Quellen.ohneKommentare gibt; CSS-Kommentare schachteln nicht, deshalb
genuegt der einfache Schnitt.

Die Aufloesung von `var(--x)` braucht es, weil --bg auf var(--s50) zeigt
statt auf einen Wert.
```

<a id="for-stelle"></a>
## `for (const [datei, erwartet] of [[ZIEL_CSS, baueCss(DATEN)], [ZIEL_KT,`

```text
Beide Erzeugnisse liegen mit im Baum — sie MUESSEN das, weil der
Android-Build kein Node kennt und DesignTokens.kt sonst gar nicht haette.
Damit sie trotzdem nicht von Hand gepflegt werden, wird hier dieselbe
Rechnung nochmals angestellt und verglichen.
DunkelTokens.kt seit dem 30.10.: vorher eine Abschrift, die nur ein Kotlin-Test
gegen die Quelle hielt — und der läuft nur, wenn sich die App ändert.
```

<a id="kt-stelle"></a>
## `const KT = fs.readFileSync(KT_THEME, 'utf8');`

```text
── Was hier noch geprueft wird ─────────────────────────────────────────

In Theme.kt stehen weiterhin Farben von Hand: die, die kein Gegenstueck im
Web haben (siehe Kopf dieser Datei). Nennt eine davon ein CSS-Token als
Herkunft, muss die Angabe stimmen. Diese Pruefung erfindet nichts — sie
liest die Behauptung aus der Datei.

Sie hat beim Anlegen sofort etwas gefunden. Dort stand

    background = Color(0xFFF1F5F9),  // --s50 equivalent

waehrend --s50 den Wert #f8fafc traegt; #f1f5f9 ist --s100. Der Kommentar
widersprach seinem eigenen Wert. Richtig war der WERT — warum, steht an
der Zeile selbst.
```
