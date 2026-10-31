# Begründungen zu `src/katalog/bilder/proxyThumbs.ts`

Die ausführlichen Kommentare aus `src/katalog/bilder/proxyThumbs.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="proxy-thumb-size"></a>
## `PROXY_THUMB_SIZE`

```text
Die Vorschau-Maschinerie des Bild-Proxys.

── Warum eigenes Modul (Nachtrag 129) ──────────────────────────────────────

registerImgProxy() war 729 Zeilen lang — eine einzige Funktion, in der Hosts
geprüft, Cache-Pfade gebaut, ETags verglichen, Grössen begrenzt, Vorschauen
gerechnet und gedrosselt wurde. Jede der Bildkorrekturen aus den Nachträgen
40 bis 49 musste da hinein, und man las jedes Mal an allem anderen vorbei.

Hier steht nur die Vorschau: Warteschlange, prozessübergreifende Sperre und
das eigentliche Verkleinern. Die drei gehören zusammen — die Sperre ist ohne
die Warteschlange sinnlos und umgekehrt.

Der Zustand (Warteschlange, Zähler) lag vorher als Closure IN
registerImgProxy(). Auf Modulebene ist er genauso prozesslokal wie zuvor:
registerImgProxy() läuft je Arbeitsprozess genau einmal. Was ÜBER die
Prozesse hinweg gelten muss, hängt ohnehin an der Advisory-Sperre in der
Datenbank — das war schon vorher so und bleibt es.
```

<a id="thumb-max-parallel"></a>
## `THUMB_MAX_PARALLEL`

```text
── Vorschaubilder sind die teuerste Arbeit im ganzen Server ──────────────

Marcos Messung: 329 % CPU im Container bei 15 MB Netzverkehr. Also keine
Warterei auf fremde Server, sondern Rechnen — und gerechnet wird hier.

Jimp ist reines JavaScript: Ein JPEG zu entpacken und zu verkleinern kostet
auf schwacher Hardware (Marcos Installation läuft auf einem Raspberry Pi)
spürbar Zeit. Der Server läuft ausserdem im CLUSTER — die Grenze unten gilt
je Arbeitsprozess, bei vier Prozessen also viermal. Zwei mal vier ergibt
acht gleichzeitige Läufe; 329 % sind gut drei Kerne.

Bis zum Umbau der Katalogliste fiel das nicht auf: Sie zeigte nur, wozu man
sich hingescrollt hatte. Seit dem Fensterladen kommen bei jedem Sprung
hunderte neue Bilder ins Blickfeld, und für jedes wurde eine Vorschau
gerechnet — ein Rückstau, der lange nach dem Scrollen weiterlief.

EIN Lauf je Prozess genügt. Die Vorschau ist eine Beschleunigung für später,
nichts, worauf jemand wartet: Bis sie fertig ist, liefert der Proxy das
Originalbild aus.
```

<a id="queuethumb"></a>
## Abschnitt

```text
── Gescheiterte Verkleinerungen nicht endlos wiederholen ──────────────

Marcos Log, immer wieder dieselbe Zeile:

    [thumb] Vorschau fehlgeschlagen für /images/sets/40393-1.jpg:
            Mime type image/webp does not support decoding

Jimp kann webp nicht entpacken. Scheitert der Versuch, entsteht keine
Datei — und beim nächsten Aufruf desselben Bildes wurde er wiederholt.
Für jedes webp-Bild also bei JEDEM Ansehen ein vergeblicher Anlauf, der
das Bild erst einliest und dann aufgibt. Der Merker `_thumbInFlight`
schützte nur für die Dauer des Laufs.

Jetzt landet der Fehlschlag im gemeinsamen Merker (src/katalog/bilder/imageMisses):
prozessübergreifend, über den Neustart hinweg, und nach sieben Tagen
wird es wieder versucht — falls die Bibliothek inzwischen mehr kann.
```

<a id="abschnitt"></a>
## Abschnitt

```text
EIN Vorschau-Lauf für den GANZEN Server — nicht je Arbeitsprozess.

── Marcos Beobachtung ────────────────────────────────────────────────────
„Es rechnen alle gleichzeitig und beginnen erst, wenn ich das erste Mal
richtig scrolle."

Genau das war der fehlende Zusatz. Die Grenze THUMB_MAX_PARALLEL gilt je
ARBEITSPROZESS, und der Server läuft im Cluster: Vier Prozesse mal ein Lauf
sind immer noch vier gleichzeitige Jimp-Läufe — auf einem Raspberry Pi
praktisch alle Kerne. Eine Grenze im Arbeitsspeicher kann das nicht lösen,
weil kein Prozess von den anderen weiss.

Die Datenbank weiss es. `pg_try_advisory_lock` gibt den Zuschlag genau
einem Prozess; wer ihn nicht bekommt, lässt es. Kein Warten, kein
Aufstauen: Die Vorschau ist eine Beschleunigung für später, und beim
nächsten Aufruf des Bildes wird es erneut versucht.

Der Schlüssel ist fest — es geht nicht um DIESES Bild, sondern darum, dass
überhaupt nur eine Verkleinerung zur Zeit läuft.
```

<a id="mitvorschausperre"></a>
## Abschnitt

```text
── NICHT aus dem Pool (Nachtrag 115) ──────────────────────────────────

Vorher lieh sich diese Sperre für die Dauer JEDER Verkleinerung eine
Pool-Verbindung. Der Pool ist auf 10–15 je Arbeitsprozess ausgelegt und
dafür da, Anfragen zu bedienen — und auf dem Primärprozess halten
Preis-Job, Anleitungs-Warteschlange und Teile-Anreicherung ohnehin schon
je eine fest. Marcos Log zeigte die Folge:

    timeout exceeded when trying to connect … at getSets

Nicht die Bildarbeit scheiterte, sondern eine gewöhnliche Anfrage bekam
keine Verbindung mehr. Dasselbe Muster wie in Nachtrag 103 — nur dass
ich es diesmal selbst hineingebaut habe, beim Beheben von Nachtrag 100.

Eine eigene, wiederverwendete Verbindung kostet EINE zusätzlich, dauerhaft
und ausserhalb des Pools. Das ist der Preis dafür, dass eine Sitzungssperre
an ihrer Sitzung hängt.
```

<a id="makeproxythumb-tmpthumb"></a>
## `tmpThumb`

```text
ATOMAR schreiben: erst daneben, dann umbenennen (Nachtrag 41).

Vorher ging der Schreibvorgang direkt auf den endgültigen Namen. Eine
Anfrage, die in genau diesem Moment hereinkommt, sieht die Datei
bereits (access() gelingt), liest per stat() eine TEILgrösse und
setzt sie als Content-Length — der Browser bekommt ein
abgeschnittenes JPEG und zeigt nichts. Auf der Platte ist die Datei
hinterher heil, der Fehler also unsichtbar; im Browser bleibt er
stehen, weil das kaputte Bild mitsamt ETag im Zwischenspeicher
landet. Genau dieses Bild: Kachel leer, Detailansicht in Ordnung —
denn die fragt dieselbe Datei OHNE thumb=1 an.

Empirisch nachgestellt: parallele Auslieferung sah 4'000 von 12'000
Bytes. rename() innerhalb desselben Dateisystems ist unteilbar — eine
Anfrage sieht entweder nichts oder die fertige Datei.

Der Bild-Cache daneben macht es seit jeher so (tmpFile → rename);
hier fehlte es. Der eindeutige Name verhindert, dass sich zwei
gleichzeitige Läufe gegenseitig überschreiben.
Der temporäre Name endet auf .jpg, NICHT auf .tmp (Nachtrag 48):
Jimp leitet das Zielformat aus der DATEIENDUNG ab. Mit `.tmp` wirft
write() „Unsupported MIME type: null", der Fehler landet im catch
darunter und wird zu einem stillen `return null`. Genau das hatte ich mir
in Nachtrag 41 eingebaut: Seither entstand ÜBERHAUPT keine Vorschau mehr
— weder hier noch im Bild-Proxy. Sichtbar wurde es erst dadurch, dass
ältere Sets ihre (vor 41 erzeugte) Vorschau behielten und neue nie eine
bekamen. Die Unteilbarkeit bleibt: geschrieben wird nebenan, dann rename.
```
