# Begründungen zu `src/katalog/http/bildProxy.ts`

Die ausführlichen Kommentare aus `src/katalog/http/bildProxy.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="proxy-cache-max-bytes"></a>
## `PROXY_CACHE_MAX_BYTES`

```text
Obergrenze für den Bild-Zwischenspeicher des Proxys.

── Warum 20 statt 5 MB (Nachtrag 43, Marcos Fund) ─────────────────────────
Marcos Kachel für Set 60445-1 blieb leer, und der direkte Aufruf der
Proxy-Adresse lud „endlos", ohne das Bild je vollständig zu zeigen. Sein
Netzwerk-Protokoll nannte die Zahl, die den Fall löst: 5'243 kB übertragen —
knapp ÜBER der damaligen 5-MB-Grenze.

Die Grenze bricht nur den CACHE-Strom ab, nicht die Auslieferung. Die Folge
war deshalb nicht „kein Bild", sondern etwas Zäheres:
  • `aborted` verhindert das rename → die Datei landet NIE im Cache
  • queueThumb() steht hinter diesem rename → es entsteht NIE eine Vorschau
  • jede Kachel holt daraufhin bei JEDEM Aufruf erneut die vollen 5 MB vom
    CDN, mehrfach parallel, während die Kachelwand lädt
Für ein einzelnes Bild wiederholt sich das bis in alle Ewigkeit, und genau
das sah aus wie „lädt endlos".

Rebrickable liefert für neuere Sets Bilder in hoher Auflösung; 5 MB waren zu
knapp bemessen. 20 MB decken diese Fälle ab und bleiben weit unter dem, was
dem Plattenplatz wehtut — der Aufräumlauf begrenzt den Cache ohnehin. Und
gerade bei grossen Bildern ist die Vorschau am wertvollsten: Sie ersetzt in
der Kachel mehrere Megabyte durch wenige Kilobyte.
```

<a id="bilddurchreichen-darferzeugen"></a>
## `darfErzeugen`

```text
gen=0: Die ANFRAGE rechnet nichts. Statt die Verkleinerung sofort
anzustossen, hinterlässt sie eine Notiz — abgearbeitet wird sie vom
Hintergrund-Job (jobs/imageQueue.ts), gedrosselt und nur auf dem
Primärprozess.

Marcos Vorgabe: „Bitte die Bilder im Hintergrund mit dem
Bilder-Download-Job herunterladen und das Thumb erstellen, sobald sie
einmal via Proxy geladen wurden."

Ausgeliefert wird trotzdem sofort: die Vorschau, wenn es sie schon gibt,
sonst das Original.
```

<a id="bilddurchreichen-mime"></a>
## `mime`

```text
── Nur Bilder ──────────────────────────────────────────────────────

Der Content-Type kam ungeprüft vom CDN und wurde so gesetzt UND im
Cache abgelegt. Die Host-Liste ist eng, aber auf den erlaubten CDNs
liegen teils von Nutzern hochgeladene Dateien: Käme dort ein SVG oder
HTML zurück, läge es anschliessend unter der EIGENEN Herkunft — und
ein SVG ist ein Dokument, das Skript enthalten kann. nosniff und die
CSP fangen den Ernstfall ab; eine Route namens img-proxy sollte
trotzdem nichts anderes als ein Bild ausliefern.

SVG ist bewusst NICHT erlaubt: Es ist das einzige Bildformat, das als
Dokument geöffnet aktiv wird, und keines der angebundenen CDNs liefert
Teile- oder Setbilder als SVG.
```
