# .design-mockups/ — Entwürfe für ein drittes App-Design

Hier liegen die **Quellen** der Design-Mockups, aus denen die Entwurfsfläche
gebaut wird. Der Entwurf selbst ist eine Frage an Marco, keine Änderung an der
Anwendung — noch ist nichts davon in `Web-App/public/themes/` oder `Theme.kt`
angekommen.

## Was hier steht

| Datei | Richtung |
|---|---|
| `Main.dc.html`, `WerkbankTelefon.dc.html` | **A · Werkbank** — anthrazit mit Bernstein |
| `PapierWeb.dc.html`, `PapierTelefon.dc.html` | **B · Papier** — Katalogseite, Serifen, Haarlinien |
| `KontrastWeb.dc.html`, `KontrastTelefon.dc.html` | **C · Kontrast** — harte Kanten, ein Signalgrün, dicht |
| `canvas.json` | Anordnung der sechs Flächen und die Notizen daneben |

Je Richtung eine Web- und eine Telefonansicht, damit sich beide Oberflächen
vergleichen lassen — dieselbe Vorgabe wie überall in diesem Projekt.

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
