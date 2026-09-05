package ch.brickinventoryapp

import org.junit.Test

/**
 * Die Kachel fuer manuelle Teile und die fuer manuelle Figuren zeigen dasselbe.
 *
 * ── Woher dieser Test kommt (Nachtrag 133) ──────────────────────────────────
 *
 * `ManualPartTile` (PartsScreen.kt) und `ManualFigTile` (MinifigsScreen.kt) sind
 * Zwillinge: gleiche Groesse, gleicher Aufbau, gleiche Knoepfe. Beim Vergleich
 * der beiden Dateien — angestossen von der Doppelungsmessung, nicht vom Lesen —
 * fehlten der Figuren-Kachel ZWEI Plaketten, die die Teile-Kachel zeigt:
 *
 *     ConditionBadges   welche Zustaende erfasst sind
 *     OwnerBadges       wem der Eintrag gehoert
 *
 * Die Webapp zeigt beide auch fuer Figuren (public/js/06-minifigs.js Zeile 327:
 * qbadge, dann condBadge, dann ownerBadges). `FigValuationItem` traegt
 * `condition`, `conditions` und `owners` seit jeher — die Felder sind im Modell
 * sogar kommentiert. Im Haushalt war an einer Figur also nicht zu sehen, wem
 * sie gehoert; am Teil daneben schon.
 *
 * ── Warum die Pruefungen die ganze Zeile nennen ────────────────────────────
 *
 * Der erste Entwurf suchte nur `OwnerBadges(fig.owners`. Die Gegenprobe blieb
 * still: `MinifigCard` — die Kachel fuer Figuren AUS EINEM SET, dieselbe Datei,
 * 160 Zeilen weiter unten — ruft dieselbe Funktion mit demselben Feld auf. Die
 * Pruefung haette also gegolten, waehrend die manuelle Kachel leer bleibt.
 *
 * Jetzt steht die vollstaendige Zeile samt Abstand da; die kommt in dieser Datei
 * genau einmal vor.
 *
 * Der Test liest nur Quelltext: kein Geraet, kein Compose.
 */
class ZwillingsKachelnTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `beide Kacheln zeigen die Zustands-Plaketten`() {
        val teile = code(read("ui/screens/PartsScreen.kt"))
        assert(teile.contains("Box(Modifier.padding(top = 3.dp)) { ConditionBadges(part.conditions, part.condition) }")) {
            "ManualPartTile zeigt die Zustaende nicht mehr"
        }
        val figuren = code(read("ui/screens/MinifigsScreen.kt"))
        assert(figuren.contains("Box(Modifier.padding(top = 3.dp)) { ConditionBadges(fig.conditions, fig.condition) }")) {
            "ManualFigTile zeigt die Zustaende nicht — anders als die Teile-Kachel " +
                "daneben und anders als die Webapp"
        }
    }

    @Test
    fun `beide Kacheln zeigen den Besitzer`() {
        val teile = code(read("ui/screens/PartsScreen.kt"))
        assert(teile.contains("OwnerBadges(part.owners, Modifier.padding(top = 2.dp))")) {
            "ManualPartTile zeigt den Besitzer nicht mehr"
        }
        val figuren = code(read("ui/screens/MinifigsScreen.kt"))
        assert(figuren.contains("OwnerBadges(fig.owners, Modifier.padding(top = 2.dp))")) {
            "ManualFigTile zeigt den Besitzer nicht — im Haushalt ist an der Figur " +
                "dann nicht zu sehen, wem sie gehoert"
        }
    }
}
