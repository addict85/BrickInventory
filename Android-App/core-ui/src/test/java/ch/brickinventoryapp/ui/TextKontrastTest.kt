package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.ui.theme.Design
import androidx.compose.material3.ColorScheme
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import ch.brickinventoryapp.ui.theme.ChartColors
import ch.brickinventoryapp.ui.theme.StatusFarben
import ch.brickinventoryapp.ui.theme.akzentflaechen
import ch.brickinventoryapp.ui.theme.diagrammFarben
import ch.brickinventoryapp.ui.theme.farbschema
import ch.brickinventoryapp.ui.theme.hatDunkleFassung
import ch.brickinventoryapp.ui.theme.reiterFarben
import ch.brickinventoryapp.ui.theme.statusFarbenFuer
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Jede Schriftrolle erreicht auf jeder Fläche, auf der Material sie zeichnet,
 * 4,5:1 (WCAG 1.4.3) — in allen sechs Designs, hell und in der dunklen Fassung.
 * Dazu sind Fehler- und Hauptfarbe unterscheidbar, damit Rot nicht doppelt spricht.
 *
 * Gegenproben:
 *   A  alte Farben: beide ersten Tests rot, 33 Paare unter 4,5:1, darunter
 *      brick.onSurfaceVariant/background 3,91, classic …/surfaceContainerHighest 3,85,
 *      noppe.primary/background 4,44, onError/error in allen dunklen Fassungen 4,48;
 *      der dritte rot mit noppe 0,03 und noppe/dunkel 0,13.
 *   B  brick.onSurfaceVariant zurück auf #6B7785 → rot (3,91 auf background)
 *   C  noppe.primary zurück auf NoppeRot → rot: „Hauptfarbe zu nah …“ (0,13)
 *
 * Diagrammfarben :
 *   D  in diagrammFarben() gedaempft wieder fest #94A3B8 → rot „Diagrammschrift …“
 *      mit classic 2,56 auf surface und 2,07 auf surfaceContainerHighest
 *
 * Akzentflächen :
 *   E  in akzentflaechen() die Stein-Flächen auch im Dunkeln (wie vor M5: Leisten in
 *      primary/secondary, Marktwert Petrol) → rot „im Dunkeln leuchtet …“ mit
 *      brick/dunkel.leiste 0,45, .detailLeiste 0,63, .markt 0,17
 *
 * Gegenproben der Farbrollen (thema.py gegen Compose Desktop; Patches unter gegenproben/):
 *   container-ohne-stauchung   → rot classic.primary/surfaceContainerHighest 4,18
 *   primarycontainer-blau50    → rot classic.primary/primaryContainer 4,24
 *   inverseprimary-ungeprueft  → rot farbfaecher.inversePrimary/inverseSurface 3,73
 *   gebraucht-linie-blass      → rot noppe.gebraucht/surface 2,61
 *   reiteranzeige-blass        → rot classic.anzeige/leiste 1,02
 *   warnfarbe-hell             → rot classic.warnung/surface 1,95
 */
class TextKontrastTest {

    private val designs = Design.entries

    private data class Fassung(val name: String, val s: ColorScheme, val status: StatusFarben, val diagramm: ChartColors)

    private val fassungen: List<Fassung> = designs.map {
        Fassung(it.kennung, farbschema(it), statusFarbenFuer(it), diagrammFarben(it, false, farbschema(it)))
    } + designs.filter { hatDunkleFassung(it) }.map {
        val s = farbschema(it, dunkel = true)
        Fassung("${it.kennung}/dunkel", s, statusFarbenFuer(it, dunkel = true), diagrammFarben(it, true, s))
    }

    /**
     * Achsen und Hinweise im Diagramm sind Schrift: 4,5:1 auf jeder Fläche, auf der
     * eine Karte liegen kann. Die Linien sind Grafik und brauchen 3:1 (WCAG 1.4.11),
     * auch die Gebraucht-Linie.
     */
    @Test
    fun `Diagrammschrift und Linien sind lesbar`() {
        val fehler = fassungen.flatMap { f ->
            val s = f.s; val d = f.diagramm
            val flaechen = listOf("surface" to s.surface, "background" to s.background,
                "surfaceContainerHighest" to s.surfaceContainerHighest)
            flaechen.mapNotNull { (n, fl) -> k(d.gedaempft, fl).takeIf { it < 4.5 }?.let { "${f.name}.gedaempft/$n %.2f".format(it) } } +
                listOf("linie" to d.linie, "neu" to d.new, "gebraucht" to d.used).mapNotNull { (n, c) ->
                    k(c, s.surface).takeIf { it < Kontrast.RAHMEN }?.let { "${f.name}.$n/surface %.2f".format(it) } }
        }
        assertTrue("Diagrammschrift oder -linie zu schwach: $fehler", fehler.isEmpty())
    }

    /** Schrift auf Fläche, so wie Material3 die Rollen paart; dazu Schrift in Haupt-, Fehler- und Gewinnfarbe. */
    private fun textPaare(f: Fassung): Map<String, Pair<Color, Color>> {
        val s = f.s
        val flaechen = mapOf("surface" to s.surface, "background" to s.background,
            "surfaceVariant" to s.surfaceVariant, "surfaceContainerLow" to s.surfaceContainerLow,
            "surfaceContainer" to s.surfaceContainer, "surfaceContainerHigh" to s.surfaceContainerHigh,
            "surfaceContainerHighest" to s.surfaceContainerHighest)
        val paare = mutableMapOf<String, Pair<Color, Color>>()
        for ((n, fl) in flaechen) {
            paare["onSurface/$n"] = s.onSurface to fl
            paare["onSurfaceVariant/$n"] = s.onSurfaceVariant to fl
        }
        // Dialoge, Menüs und Blätter liegen auf den Containerstufen; ihre Textknöpfe sind primary.
        for ((n, fl) in flaechen) {
            paare["primary/$n"] = s.primary to fl
            paare["error/$n"] = s.error to fl
        }
        for (n in listOf("surface", "background", "surfaceContainer")) {
            paare["erfolg/$n"] = f.status.erfolg to flaechen.getValue(n)
            paare["fehler/$n"] = f.status.fehler to flaechen.getValue(n)
        }
        paare["primary/primaryContainer"] = s.primary to s.primaryContainer
        paare["inversePrimary/inverseSurface"] = s.inversePrimary to s.inverseSurface
        paare["onPrimary/primary"] = s.onPrimary to s.primary
        paare["onPrimaryContainer/primaryContainer"] = s.onPrimaryContainer to s.primaryContainer
        paare["onSecondary/secondary"] = s.onSecondary to s.secondary
        paare["onSecondaryContainer/secondaryContainer"] = s.onSecondaryContainer to s.secondaryContainer
        paare["onTertiary/tertiary"] = s.onTertiary to s.tertiary
        paare["onTertiaryContainer/tertiaryContainer"] = s.onTertiaryContainer to s.tertiaryContainer
        paare["onError/error"] = s.onError to s.error
        paare["onErrorContainer/errorContainer"] = s.onErrorContainer to s.errorContainer
        paare["inverseOnSurface/inverseSurface"] = s.inverseOnSurface to s.inverseSurface
        return paare
    }

    private fun k(a: Color, b: Color) = Kontrast.verhaeltnis(a.toArgb(), b.toArgb())

    private fun akzent(f: Fassung) = akzentflaechen(checkNotNull(Design.aus(f.name.substringBefore('/'))), f.name.endsWith("/dunkel"), f.s)

    /** App-Leisten und Wert-Kacheln: Schrift auf ihrer Fläche wie jede andere Rolle. */
    @Test
    fun `Leisten und Wert-Kacheln tragen lesbare Schrift`() {
        val fehler = fassungen.flatMap { f ->
            val a = akzent(f)
            listOf("leiste" to (a.aufLeiste to a.leiste), "detailLeiste" to (a.aufDetailLeiste to a.detailLeiste),
                "markt" to (a.aufMarkt to a.markt), "kauf" to (a.aufKauf to a.kauf))
                .mapNotNull { (n, p) -> k(p.first, p.second).takeIf { it < 4.5 }?.let { "${f.name}.$n %.2f".format(it) } }
        }
        assertTrue("Unter 4,5:1: $fehler", fehler.isEmpty())
    }

    /**
     * Im Dunkeln keine hellen Flächen (Material 3: Container-Rollen): Eine Leiste oder
     * Kachel heller als die Schrift auf ihr leuchtet auf Schwarz und zieht den Blick
     * vom Inhalt weg. Gemessen als relative Luminanz; onSurface liegt bei rund 0,8.
     */
    @Test
    fun `im Dunkeln leuchtet keine Leiste und keine Kachel`() {
        val fehler = fassungen.filter { it.name.endsWith("/dunkel") || it.name == "werkbank" }.flatMap { f ->
            val a = akzent(f)
            listOf("leiste" to a.leiste, "detailLeiste" to a.detailLeiste, "markt" to a.markt, "kauf" to a.kauf)
                .mapNotNull { (n, c) -> Kontrast.luminanz(c.toArgb()).takeIf { it > 0.1 }?.let { "${f.name}.$n %.2f".format(it) } }
        }
        assertTrue("Helle Fläche im Dunkeln: $fehler", fehler.isEmpty())
    }

    /** Der Marktwert ist der wichtigste Wert der Detailseite; seine Kachel hebt sich stärker ab als der Kaufpreis. */
    @Test
    fun `die Marktwert-Kachel ist auffaelliger als die Kaufpreis-Kachel`() {
        val fehler = fassungen.mapNotNull { f ->
            val a = akzent(f)
            val markt = k(a.markt, f.s.surface); val kauf = k(a.kauf, f.s.surface)
            if (markt < kauf * 1.2) "${f.name} %.2f gegen %.2f".format(markt, kauf) else null
        }
        assertTrue("Kaufpreis-Kachel kräftiger als der Marktwert: $fehler", fehler.isEmpty())
    }

    @Test
    fun `jede Schriftrolle erreicht 4,5 zu 1 auf ihrer Flaeche`() {
        val fehler = fassungen.flatMap { f ->
            textPaare(f).mapNotNull { (n, p) -> k(p.first, p.second).takeIf { it < 4.5 }?.let { "${f.name}.$n %.2f".format(it) } }
        }
        assertTrue("Unter 4,5:1: $fehler", fehler.isEmpty())
    }

    /** Das gewählte Ziel der Navigation ist an der Fläche seiner Anzeige erkennbar, nicht nur am Farbton. */
    @Test
    fun `die Anzeige des gewaehlten Reiters hebt sich von Leiste und Seitenleiste ab`() {
        val fehler = fassungen.flatMap { f ->
            val r = reiterFarben(f.s)
            listOf("leiste" to r.leiste, "seitenleiste" to f.s.surface).mapNotNull { (n, fl) ->
                k(r.anzeige, fl).takeIf { it < Kontrast.RAHMEN }?.let { "${f.name}.anzeige/$n %.2f".format(it) }
            } + listOf("aufAnzeige" to (r.aufAnzeige to r.anzeige), "gewaehlt" to (r.gewaehlt to r.leiste),
                "ungewaehlt" to (r.ungewaehlt to r.leiste)).mapNotNull { (n, p) ->
                k(p.first, p.second).takeIf { it < 4.5 }?.let { "${f.name}.$n %.2f".format(it) }
            }
        }
        assertTrue("Gewählter Reiter kaum erkennbar: $fehler", fehler.isEmpty())
    }

    /** Warnfarbe zeichnet Balken und Symbole (Monitoring, CSV-Bericht): Grafik braucht 3:1. */
    @Test
    fun `Warnfarbe ist als Grafik auf jeder Flaeche sichtbar`() {
        val fehler = fassungen.flatMap { f ->
            listOf("surface" to f.s.surface, "background" to f.s.background, "surfaceContainer" to f.s.surfaceContainer)
                .mapNotNull { (n, fl) -> k(f.status.warnung, fl).takeIf { it < Kontrast.RAHMEN }?.let { "${f.name}.warnung/$n %.2f".format(it) } }
        }
        assertTrue("Unter 3:1: $fehler", fehler.isEmpty())
    }

    @Test
    fun `Rahmen von Bedienelementen erreichen 3 zu 1`() {
        val fehler = fassungen.flatMap { f ->
            val s = f.s
            listOf("surface" to s.surface, "background" to s.background, "surfaceVariant" to s.surfaceVariant,
                "surfaceContainerHighest" to s.surfaceContainerHighest, "primaryContainer" to s.primaryContainer)
                .mapNotNull { (n, fl) -> k(s.outline, fl).takeIf { it < Kontrast.RAHMEN }?.let { "${f.name}.outline/$n %.2f".format(it) } }
        }
        assertTrue("Unter 3:1: $fehler", fehler.isEmpty())
    }

    /**
     * Löschen und Fehler dürfen nicht wie die Hauptfarbe aussehen. Maß ist der
     * Abstand im RGB-Raum (0 bis 1,73): Blau gegen Rot liegt über 0,8, das
     * Noppe-Rot #D91F26 neben #B91C1C bei 0,13.
     */
    @Test
    fun `Fehlerfarbe weicht deutlich von der Hauptfarbe ab`() {
        val fehler = fassungen.mapNotNull { f ->
            val a = f.s.primary; val b = f.s.error
            val d = kotlin.math.sqrt(((a.red - b.red) * (a.red - b.red) + (a.green - b.green) * (a.green - b.green) +
                (a.blue - b.blue) * (a.blue - b.blue)).toDouble())
            if (d < 0.15) "${f.name} %.2f".format(d) else null
        }
        assertTrue("Hauptfarbe zu nah an der Fehlerfarbe: $fehler", fehler.isEmpty())
    }
}
