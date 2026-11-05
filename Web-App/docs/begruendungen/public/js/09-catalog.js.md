# Begründungen zu `public/js/09-catalog.js`

Die ausführlichen Kommentare aus `public/js/09-catalog.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="cat-limit"></a>
## `CAT_LIMIT`

```text
── Fensterladen statt Endlos-Scroll ─────────────────────────

Marcos Vorgabe: Die Jahres-Leiste soll nicht filtern, sondern schnell
scrollen — „kann nicht geprüft werden, wo man hinscrollt, und dieser Teil
wird dann geladen".

Mit einer angehängten Liste geht das nicht: Wer auf 2005 springt, landet
mitten im Bestand, und darüber wie darunter fehlt alles. Die Liste führt
deshalb einen Block je SEITE über das ganze Ergebnis; geladen wird der Block,
der ins Bild kommt — vorwärts wie rückwärts. Ungeladene Blöcke halten ihre
Höhe mit Platzhaltern frei, damit nichts springt.
```

<a id="ungeladene-seiten-sind-ein-leerer-block"></a>
## Ungeladene Seiten sind EIN leerer Block, nicht 60 Kachel-Platzhalter.

```text
Ungeladene Seiten sind EIN leerer Block, nicht 60 Kachel-Platzhalter.
Bei 25 000 Sets wären das über 25 000 Elemente auf einmal — der Browser
baut sie, aber langsam, und jeder Scroll-Schritt kostet danach. Die
Höhe kommt gleich nach dem Zeichnen aus der GEMESSENEN ersten Seite
(siehe _setzePlatzhalterHoehe): geraten wäre sie falsch, sobald das
Fenster eine andere Spaltenzahl ergibt.
```

<a id="catblocklagen"></a>
## `_catBlockLagen`

```text
Wo liegt welcher Seitenblock? EINMAL gemessen, dann aus dem Gedächtnis.

── Marcos Meldung ──────────────────────────────────────────────────────────
„Wenn ich im Katalog zu einem Jahr scrolle, hängt die Applikation wieder
(CPU auf 100 %)."

Die vorige Fassung fragte bei JEDEM Bild jeden einzelnen Block nach seiner
Lage (`getBoundingClientRect`). Bei rund 25 000 Sets sind das über
vierhundert Blöcke — und jede dieser Abfragen zwingt den Browser, das Layout
neu zu berechnen. Beim Ziehen über die ganze Leiste passiert das sechzigmal
je Sekunde. Der Balken tat also genau das, wogegen er helfen sollte.

Die Lagen ändern sich nur, wenn eine Seite eintrifft oder das Fenster sich
ändert — dann wird neu gemessen, sonst nie.
```

<a id="die-seiten-laden-die-im-bild-stehen-erst"></a>
## Die Seiten laden, die im Bild stehen — erst, wenn das Rollen zur Ruhe kommt.

```text
Die Seiten laden, die im Bild stehen — erst, wenn das Rollen zur Ruhe kommt.

── Warum verzögert ─────────────────────────────────────────────────────────
Wer den Balken von oben nach unten zieht, kommt an JEDER Stelle der Liste
vorbei. Ohne Verzögerung fordert das ein paar hundert Seiten an, von denen
nur die letzte je angesehen wird — jede mit einer Abfrage über 25 000 Zeilen
und bis zu sechzig Bildern im Schlepptau. Das ist die Last aus Marcos
Meldung.

150 ms Ruhe genügen: Beim gewöhnlichen Scrollen merkt man sie nicht, ein Zug
über die ganze Leiste löst dagegen genau EINEN Abruf aus — am Ziel.
```

<a id="src"></a>
## `src`

```text
Über den Server statt direkt im Browser vom CDN — dieselbe Logik wie
Sets, Teile und Minifiguren (imgUrl(thumbUrl(...), true)), auf Wunsch
auch für den Katalog vereinheitlicht. Vorteil gegenüber der bisherigen
rohen CDN-Adresse: kleineres Vorschaubild statt der vollen Auflösung,
und derselbe serverseitige Existenz-Check auf image_local wie überall
sonst — lokal bereits heruntergeladene Sets (irgendein Nutzer hat sie
schon einmal seinem Bestand hinzugefügt) sparen den CDN-Umweg komplett.
```

<a id="detailsrc"></a>
## `detailSrc`

```text
Volle Auflösung im Detail-Modal — wie beim Zoom der eigenen Sets
(11-actions.js, openImageLightboxFromEl): NICHT über den Proxy, sondern
direkt im Browser vom CDN geladen. Das ist bewusst so: Der Server-Umweg
lohnt sich für die kleine Vorschau (spart Bandbreite, profitiert vom
Existenz-Check auf image_local), aber für die einmalige volle Auflösung
im Detail-Dialog ist der direkte Browser-Zugriff schneller UND entlastet
den Server — genau der Unterschied, den ein direkt geöffneter CDN-Link
(unter einer Sekunde) gegenüber dem Server-Proxy zeigt.
```

<a id="bl"></a>
## `bl`

```text
Kauf-Link kommt fertig vom Server (src/katalog/bricklinkLink.ts). Vorher wurde er
hier aus der Rebrickable-Nummer gebaut und immer als Set verlinkt (S=…) —
für alles, was BrickLink als Gear oder Buch führt, war damit sowohl der
Parameter als auch die Nummer falsch (dort ohne "-1"-Suffix).
url ist immer gesetzt: Ist der Artikel nicht eindeutig bestimmbar, zeigt
sie auf die BrickLink-Suche. Der Button wird nie ausgeblendet — bei
Sammelminifiguren (Rebrickable führt sie als Set, BrickLink als MINIFIG mit
anderer Nummer) war er sonst weg, obwohl der Artikel dort sehr wohl
existiert, nur eben unter einer Nummer, die niemand herleiten kann.
```

<a id="cat-modal"></a>
## `cat-modal`

```text
Die Setnummer am Modal hinterlegen: Der Merklisten-Knopf liegt in einem
anderen Modul und hat auf _catCurSet keinen Zugriff. Ein Export waere ein
zweiter Weg zu demselben Zustand — das Modal weiss ohnehin, was es zeigt.

Hier und nicht oben bei _catCurSet: test/catalog-local-images.test.js
liest ein Fenster ab openCatModal und prueft darin die Bildzeile. Ein
Einschub davor schiebt sie hinaus — die Zuweisung gehoert an die Stelle,
an der das Modal aufgeht, und stoert dort niemanden.
```

<a id="jahranposition"></a>
## `_jahrAnPosition`

```text
═══ Jahres-Etikett am gemeinsamen Scrollbalken ═════════════════════════════

Den Balken selbst zeichnet die Anwendung für die ganze Seite (js/01-core.js,
#app-scrollbar). Der Katalog trägt hier nur bei, WAS beim Ziehen daneben
steht: das Jahr an der aktuellen Stelle.

Gelesen wird es aus der obersten SICHTBAREN Kachel — das ist die Wahrheit,
sobald die Seite geladen ist. Nur für noch leere Bereiche wird linear
geschätzt; dort weiss der Browser es schlicht nicht. Eine rein lineare
Rechnung wäre falsch, sobald ein Jahr mehr Sets hat als ein anderes.
```

<a id="if"></a>
## `if`

```text
Zweite Wahl: über die tatsächliche VERTEILUNG rechnen.

Marcos Befund: Vorher wurde die Position linear auf den Jahresbereich
umgerechnet — als läge zwischen 1949 und 2027 in jedem Jahr gleich viel.
Tatsächlich stammt der weitaus grösste Teil des Katalogs aus den letzten
Jahrzehnten. Neun Zehntel hinuntergezogen stand deshalb „1965", während
gleich darauf Sets von 1999 erschienen.

Jetzt wird aus der Position eine laufende NUMMER und daraus das Jahr, in
dem diese Nummer wirklich liegt.
```
