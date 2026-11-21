package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.screens.PagesSituation
import ch.brickinventoryapp.finances.ui.screens.zoomZielX
import ch.brickinventoryapp.finances.ui.screens.zoomZielY
import org.junit.Test
import kotlin.math.abs
import kotlin.math.floor

/**
 * Beim Zoomen bleibt der Punkt zwischen den Fingern stehen.
 *
 * Gerechnet wird an einem Modell der Seitenliste: gleich hohe Seiten, fester
 * Rand und Abstand, so wie PdfPages sie legt. Vor und nach dem Schritt wird
 * bestimmt, welche Stelle welcher Seite unter dem Anker liegt.
 *
 * Gegenproben (am 27.10. mit kotlinc gemessen):
 *   A  zoomZielY bekommt anchorY = 0 statt des Fingerpunkts (das alte Verhalten:
 *      die Oberkante bleibt stehen) → rot: „bleibt stehen", „Geste aus kleinen
 *      Schritten", „Herauszoomen"
 *   B  zoomZielX rechnet ohne Rand (rand = 0) → rot: „waagerecht"
 *   C  die Rueckwaertssuche in zoomZielY entfernt → rot: „bleibt stehen",
 *      „Geste aus kleinen Schritten", „Herauszoomen"
 */
class PdfZoomAnchorTest {

    private val edge = 16
    private val abstand = 16
    private val baseHeight = 1400f      // Seitenhoehe bei 1x

    /** Die Liste bei Zoom [z], erste Seite [erste] um [versatz] nach oben gerollt. */
    private inner class Liste(val z: Float, val erste: Int, val versatz: Int) {
        val h get() = baseHeight * z
        val schritt get() = h + abstand

        fun sichtbar(): List<PagesSituation> = (erste until erste + 6).map { i ->
            PagesSituation(i, (edge - versatz + (i - erste) * schritt).toInt(), h.toInt())
        }

        /** Seite und Anteil (0..1) unter der Sichthoehe [y]. */
        fun place(y: Float): Pair<Int, Float> {
            val inhalt = y + erste * schritt + versatz - edge
            val seite = floor(inhalt / schritt).toInt()
            return seite to (inhalt - seite * schritt) / h
        }

        fun zoom(f: Float, y: Float): Liste {
            val (i, v) = zoomZielY(sichtbar(), y, f, edge, abstand)!!
            return Liste(z * f, i, v)
        }
    }

    private fun samePlace(vorher: Pair<Int, Float>, after: Pair<Int, Float>, h: Float, tolerancePx: Float) {
        assert(vorher.first == after.first && abs(vorher.second - after.second) * h <= tolerancePx) {
            "Unter den Fingern lag Seite ${vorher.first} bei ${"%.3f".format(vorher.second)}, " +
                "danach Seite ${after.first} bei ${"%.3f".format(after.second)}"
        }
    }

    @Test
    fun `the point between the fingers stays put`() {
        val vorher = Liste(1f, 3, 200)
        for (y in listOf(300f, 1000f, 1700f)) {
            val after = vorher.zoom(1.25f, y)
            samePlace(vorher.place(y), after.place(y), after.h, 1.5f)
        }
    }

    @Test
    fun `a gesture of many small steps does not drift`() {
        // So kommt eine Zwei-Finger-Geste an: ein Faktor je Bild. Jeder
        // Rundungsfehler bliebe stehen und summierte sich.
        val y = 1400f
        var liste = Liste(1f, 7, 500)
        val start = liste.place(y)
        repeat(28) { liste = liste.zoom(1.05f, y) }
        assert(liste.z > 3.8f) { "Vorbedingung: bis ueber 3.8x gezoomt, war ${liste.z}" }
        samePlace(start, liste.place(y), liste.h, 15f)
    }

    @Test
    fun `when zooming out the list starts with an earlier page`() {
        // Anker knapp unter der Oberkante: Die Seite darunter rueckt nach unten,
        // und die vorige Seite muss oben ins Bild.
        val vorher = Liste(3f, 5, 100)
        val y = 400f
        val after = vorher.zoom(0.5f, y)
        assert(after.erste < 5) { "Die Liste beginnt noch mit Seite ${after.erste}" }
        assert(after.versatz >= 0) { "Negativer Versatz ${after.versatz}" }
        samePlace(vorher.place(y), after.place(y), after.h, 1.5f)
    }

    @Test
    fun `at the start of the document the list stays at the top`() {
        val (i, v) = zoomZielY(Liste(2f, 0, 0).sichtbar(), 1000f, 0.5f, edge, abstand)!!
        assert(i == 0 && v == 0) { "Erwartet Seite 0 ohne Versatz, war $i/$v" }
        assert(zoomZielY(emptyList(), 500f, 2f, edge, abstand) == null) { "Ohne Seiten gibt es kein Ziel" }
    }

    @Test
    fun `horizontally the point stays put, even from 1x`() {
        val breite = 1048f                  // Seitenbreite bei 1x, ohne Rand
        var z = 1f
        var scroll = 0
        val x = 900f                        // rechts im Bild
        val share = { (scroll + x - edge) / (breite * z) }
        val start = share()
        repeat(20) { scroll = zoomZielX(scroll, x, edge.toFloat(), 1.08f); z *= 1.08f }
        assert(abs(share() - start) * breite * z <= 12f) {
            "Unter dem Finger lag ${"%.3f".format(start)} der Seitenbreite, danach ${"%.3f".format(share())}"
        }
        assert(zoomZielX(0, 500f, edge.toFloat(), 0.5f) == 0) { "Beim Herauszoomen links ueber den Anfang hinaus gerollt" }
    }
}
