# Begründungen zu `public/js/12-pdfviewer.js`

Die ausführlichen Kommentare aus `public/js/12-pdfviewer.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="diese-110-zeilen-standen-in-js-01-core-j"></a>
## Diese 110 Zeilen standen in js/01-core.js. Deren Kopfzeile nennt als Inhalt

```text
── PDF-Viewer (PDF.js, lokal eingebunden) ────────────────────────────────────

── Warum eigene Datei ────────────────────────────────────────

Diese 110 Zeilen standen in js/01-core.js. Deren Kopfzeile nennt als Inhalt
„Utils, i18n-Glue, Auth & Panels, Login/Logout, CSV-Import-Fortschrittsbalken"
— ein PDF-Betrachter ist nichts davon. Die Datei war 1479 Zeilen lang und
hiess nach ihrer Geschichte, nicht nach ihrem Inhalt.

Der Betrachter hängt an genau zwei Dingen aus dem Kern (G, esc) und wird von
aussen über openPdfViewer() gerufen; die Knöpfe meldet er selbst beim
Dispatcher an. Damit ist er ein sauberer Schnitt.
```

<a id="pdf-leinwand-max-px"></a>
## `PDF_LEINWAND_MAX_PX`

```text
Obergrenze für die Leinwand, in Pixeln der Fläche.

GEMESSEN in Chromium 142 (headless, playwright-core), A4-Verhältnis 1 : 1,414:

  Breite    Höhe   MPixel      RAM   brauchbar
    4096    5793    23,7    91 MB   ja
    6144    8689    53,4   204 MB   ja
   11586   16385   189,8   724 MB   ja
   16384   23170   379,6  1448 MB   NEIN   (16384 ist die harte Grenze)

„Brauchbar" heisst hier: ein gesetztes Pixel kommt per getImageData auch
zurück. Die harte Grenze liegt also weit über allem, was man wollen würde —
der Riegel hier ist der SPEICHER, nicht die Grenze. 16 MPixel sind rund
64 MB je Seite; der IntersectionObserver unten hält nur die sichtbaren
Seiten, bei starkem Zoom also eine bis zwei.

Wird der Riegel erreicht, bleibt die Anzeige richtig und wird nur weicher:
die Leinwand ist dann kleiner als ihr CSS-Kasten und wird hochskaliert.
```

<a id="pdfmassplatzhalter"></a>
## `_pdfMassPlatzhalter`

```text
Einen Platzhalter auf die aktuelle Zoomgrösse bringen.

Das `margin:0 auto` ist kein Geschmack, es ist der Riegel gegen eine
GEMESSENE Falle. Behälter 400px breit mit den Stilen aus index.html,
Zeile 1526, Chromium 142 (headless, playwright-core):

                             Seite 1200px breit        Seite 200px breit
                          scrollW  linker Rand         Lage
  align-items:center (heute)  800        −400   weg    mittig
  center + margin:0 auto     1200           0   da     mittig
  flex-start + margin:0 auto 1200           0   da     mittig

Erste Zeile: Ist die Seite breiter als der Behälter, sind 400 von 1200 Pixeln
links NICHT erreichbar. Der Behälter rollt nicht dorthin — sein scrollWidth
kennt sie gar nicht (800 statt 1200). Das ist die alte Flexbox-Eigenheit:
zentriert wird auch NEGATIVER Platz, und die Hälfte davon landet vor dem
Rollbereich. Ohne diesen Riegel wäre beim Hineinzoomen die linke
Seitenhälfte verloren — genau die Hälfte, auf der bei Anleitungen die
Teileliste steht.

Zweite Zeile ist, was ausgeliefert wird: auto-Ränder schlagen align-self,
zentrieren weiter, solange Platz da ist, und werden zu 0, sobald es eng wird.
Der Behälter in index.html bleibt deshalb unangetastet.

Nicht genommen: `align-items:safe center` tut dasselbe (ebenfalls gemessen),
fällt aber auf älteren Browsern als ganze Deklaration aus — dann gilt
`normal`, also stretch, und die Seiten wären verzerrt. `margin:auto` gibt es
überall.
```

<a id="zwischenzeitlich-gezoomt-diese-leinwand"></a>
## `if`

```text
Zwischenzeitlich gezoomt. Diese Leinwand hat die Auflösung von VORHER.

Verzerrt wäre sie nicht — das Seitenverhältnis ist dasselbe, width:100%
streckt sie nur. Der Schaden ist ein anderer: Hängt sie erst einmal
drin, kehrt der neue Durchlauf gleich oben wieder um
(`if (ph.querySelector('canvas')) return`), und die Seite bleibt bis zum
nächsten Zoom oder Rollen in der alten, zu groben Auflösung stehen.
Genau das ist der Fall, den man nicht sieht, solange der alte Durchlauf
schneller fertig wird als der neue — und bei starkem Zoom ist er das,
denn er hat weniger zu rendern.
```

<a id="pdfrad"></a>
## `_pdfRad`

```text
Mausrad mit Strg/⌘ zoomt, ohne Zusatztaste rollt es weiter.

Strg+Rad ist die Geste, mit der Browser seit je die Seite zoomen; genau die
fängt der Betrachter hier ab, damit sie das PDF zoomt und nicht die ganze
Oberfläche. Ohne Zusatztaste bleibt das Rad beim Rollen — wer durch eine
80-seitige Anleitung blättert, will nicht zoomen.

Der Zeiger ist der Anker: man zoomt auf das, worauf man zeigt.
```

<a id="pdfhaengezuhoererein"></a>
## `_pdfHaengeZuhoererEin`

```text
Die Zuhörer hängen am Behälter und nicht am Fenster, und sie werden EINMAL
angemeldet — beim Laden des Moduls, nicht bei jedem openPdfViewer(). Sonst
sammelt jedes geöffnete PDF einen weiteren Zuhörer an, und nach zehn
Anleitungen zoomt ein Raddreh um das Zehnfache.

`passive:false` ist bei wheel und touchmove nötig: ohne das darf
preventDefault() nicht wirken, und der Browser zoomt zusätzlich die ganze
Oberfläche.
```
