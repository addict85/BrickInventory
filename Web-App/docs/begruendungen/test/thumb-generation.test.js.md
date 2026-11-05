# Begründungen zu `test/thumb-generation.test.js`

Die ausführlichen Kommentare aus `test/thumb-generation.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Vorschaubilder entstehen WIRKLICH — und fehlende heilen sich selbst.

── Woher dieser Test kommt (Nachtrag 48) ───────────────────────────────────
Marco meldete: „In der Setgalerie werden für neue Sets keine Thumbs
angezeigt, sondern immer die grossen Bilder. Bei älter erfassten Sets wird
das Thumb korrekt genutzt." Und auf Nachfrage: die Datei `…_thumb.jpg`
existiert auf dem Server gar nicht.

Zwei Ursachen, beide von mir eingebaut bzw. übersehen:

1. MEIN FEHLER AUS NACHTRAG 41. Beim Umbau auf atomares Schreiben bekam die
   temporäre Datei den Namen `<ziel>.<pid>.<zeit>.tmp`. Jimp leitet das
   Zielformat aber aus der DATEIENDUNG ab: `.tmp` ergibt „Unsupported MIME
   type: null". Der Fehler landete im umgebenden catch und wurde zu einem
   stillen `return null`. Seither entstand ÜBERHAUPT KEINE Vorschau mehr —
   weder lokal noch im Bild-Proxy. Sichtbar wurde es nur, weil ältere Sets
   ihre vor 41 erzeugte Vorschau behielten. Genau diese Sorte Fehler prüft
   der erste Teil hier: nicht „steht der rename im Code", sondern „liegt
   hinterher eine Datei da, und ist sie kleiner als das Original".

2. Die Vorschau war ein reines ERFASSUNGS-Ereignis: erzeugt nur direkt nach
   dem Download. Ging dabei etwas schief, entstand sie nie mehr — der
   Bilder-Nachlauf deckt `sets` nicht ab und repariert ohnehin nur fehlende
   Dateien, keine fehlenden Vorschauen. Deshalb stösst die Bildroute die
   Erzeugung jetzt an, wenn sie beim Ausliefern bemerkt, dass die Vorschau
   fehlt und das Original vorliegt.
```
