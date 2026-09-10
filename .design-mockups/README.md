# .design-mockups/ — Entwürfe für ein drittes App-Design

Hier liegen die **Quellen** der Design-Mockups, aus denen die Entwurfsfläche
gebaut wird. Der Entwurf selbst ist eine Frage an Marco, keine Änderung an der
Anwendung — noch ist nichts davon in `Web-App/public/themes/` oder `Theme.kt`
angekommen.

## Was hier steht

| Datei | Richtung | Achse |
|---|---|---|
| `Main.dc.html`, `WerkbankTelefon.dc.html` | **A · Werkbank** — anthrazit mit Bernstein | Stimmung (dunkel) |
| `PapierWeb.dc.html`, `PapierTelefon.dc.html` | **B · Papier** — Katalogseite, Serifen, Haarlinien | Medium (Druck) |
| `KontrastWeb.dc.html`, `KontrastTelefon.dc.html` | **C · Kontrast** — harte Kanten, ein Signalgrün | Dichte |
| `VitrineWeb.dc.html`, `VitrineTelefon.dc.html` | **D · Vitrine** — vier Spalten, 4:3-Bild, viel Luft | Bildgrösse |
| `BlaupauseWeb.dc.html`, `BlaupauseTelefon.dc.html` | **E · Blaupause** — Millimeterraster, Schriftfeld, Mono | Metapher |
| `FarbfaecherWeb.dc.html`, `FarbfaecherTelefon.dc.html` | **F · Farbfächer** — Thema=Farbton, Bedienung grau | Farbe als Auskunft |
| `canvas.json` | Anordnung der zwölf Flächen und die Notizen daneben | |

Je Richtung eine Web- und eine Telefonansicht, damit sich beide Oberflächen
vergleichen lassen — dieselbe Vorgabe wie überall in diesem Projekt.

Die Richtungen sind bewusst über verschiedene ACHSEN verteilt und nicht über
Farbvarianten desselben Gedankens: Sechs Abstufungen einer Idee sind keine
Auswahl. Zu jeder steht in `canvas.json` eine Notiz mit ihrem Haken — eine
Sammlung, in der nur der Favorit eine Begründung bekommt, ist eine gelenkte
Abstimmung.

**A bis F behalten ihre Namen und Plätze.** Kommt eine Richtung dazu, wird sie
angehängt; nummeriert oder umbenannt wird nichts, sonst zeigt eine spätere
Rückfrage („nimm B") auf etwas anderes als beim ersten Mal.

## Woher die Masse stammen

Nicht erfunden, sondern aus dem Baum GELESEN, damit die Entwürfe wirklich das
Design zeigen und nicht nebenbei die Struktur ändern:

| | Quelle |
|---|---|
| Raster `repeat(auto-fill, minmax(185px, 1fr))`, Abstand 16px | `Web-App/public/styles.css`, `.sgrid` |
| Karte: 1.5px Rahmen, `--sh0` | `.sc` |
| Bildfeld `aspect-ratio: 1` | `.sci` |
| Kartenrumpf 11px | `.scb` |
| Setnummer: JetBrains Mono, 11.2px, 500 | `.snum` |
| Setname: 13.1px, 600, Zeilenhöhe 1.3 | `.sname` |
| Plaketten: Radius 999px | `.qbadge`, `.ibadge` |
| Telefon: Kachel 212dp, Bildfeld 118dp, Raster `Adaptive(160.dp)` | `CatalogScreen.kt`, `CatalogSetCard` |

## Was NICHT hier liegt

Die zusammengebaute Entwurfsfläche (rund 2,5 MB, enthält den Editor) ist ein
Erzeugnis und steht in `.gitignore`. Sie entsteht neu aus diesen Quellen; wer
sie braucht, baut sie mit dem `design`-Ablauf erneut.

## Zahlen darin

Setnamen, Stückzahlen und Beträge sind **Beispieldaten**. Statt Set-Fotos steht
ein gezeichneter Platzhalter — ein schlechter Nachbau echter Bilder hätte den
Vergleich der Entwürfe verfälscht.
