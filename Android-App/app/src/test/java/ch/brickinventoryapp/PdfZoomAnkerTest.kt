package ch.brickinventoryapp

import ch.brickinventoryapp.ui.screens.SeitenLage
import ch.brickinventoryapp.ui.screens.zoomZielX
import ch.brickinventoryapp.ui.screens.zoomZielY
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
 *   A  zoomZielY bekommt ankerY = 0 statt des Fingerpunkts (das alte Verhalten:
 *      die Oberkante bleibt stehen) → rot: „bleibt stehen", „Geste aus kleinen
 *      Schritten", „Herauszoomen"
 *   B  zoomZielX rechnet ohne Rand (rand = 0) → rot: „waagerecht"
 *   C  die Rueckwaertssuche in zoomZielY entfernt → rot: „bleibt stehen",
 *      „Geste aus kleinen Schritten", „Herauszoomen"
 */
class PdfZoomAnkerTest {

    private val rand = 16
    private val abstand = 16
    private val sichtHoehe = 2000f
    private val basisHoehe = 1400f      // Seitenhoehe bei 1x

    /** Die Liste bei Zoom [z], erste Seite [erste] um [versatz] nach oben gerollt. */
    private inner class Liste(val z: Float, val erste: Int, val versatz: Int) {
        val h get() = basisHoehe * z
        val schritt get() = h + abstand

        fun sichtbar(): List<SeitenLage> = (erste until erste + 6).map { i ->
            SeitenLage(i, (rand - versatz + (i - erste) * schritt).toInt(), h.toInt())
        }

        /** Seite und Anteil (0..1) unter der Sichthoehe [y]. */
        fun stelle(y: Float): Pair<Int, Float> {
            val inhalt = y + erste * schritt + versatz - rand
            val seite = floor(inhalt / schritt).toInt()
            return seite to (inhalt - seite * schritt) / h
        }

        fun zoom(f: Float, y: Float): Liste {
            val (i, v) = zoomZielY(sichtbar(), y, f, rand, abstand)!!
            return Liste(z * f, i, v)
        }
    }

    private fun gleicheStelle(vorher: Pair<Int, Float>, nachher: Pair<Int, Float>, h: Float, toleranzPx: Float) {
        assert(vorher.first == nachher.first && abs(vorher.second - nachher.second) * h <= toleranzPx) {
            "Unter den Fingern lag Seite ${vorher.first} bei ${"%.3f".format(vorher.second)}, " +
                "danach Seite ${nachher.first} bei ${"%.3f".format(nachher.second)}"
        }
    }

    @Test
    fun `der Punkt zwischen den Fingern bleibt stehen`() {
        val vorher = Liste(1f, 3, 200)
        for (y in listOf(300f, 1000f, 1700f)) {
            val nachher = vorher.zoom(1.25f, y)
            gleicheStelle(vorher.stelle(y), nachher.stelle(y), nachher.h, 1.5f)
        }
    }

    @Test
    fun `eine Geste aus vielen kleinen Schritten driftet nicht ab`() {
        // So kommt eine Zwei-Finger-Geste an: ein Faktor je Bild. Jeder
        // Rundungsfehler bliebe stehen und summierte sich.
        val y = 1400f
        var liste = Liste(1f, 7, 500)
        val start = liste.stelle(y)
        repeat(28) { liste = liste.zoom(1.05f, y) }
        assert(liste.z > 3.8f) { "Vorbedingung: bis ueber 3.8x gezoomt, war ${liste.z}" }
        gleicheStelle(start, liste.stelle(y), liste.h, 15f)
    }

    @Test
    fun `beim Herauszoomen beginnt die Liste mit einer frueheren Seite`() {
        // Anker knapp unter der Oberkante: Die Seite darunter rueckt nach unten,
        // und die vorige Seite muss oben ins Bild.
        val vorher = Liste(3f, 5, 100)
        val y = 400f
        val nachher = vorher.zoom(0.5f, y)
        assert(nachher.erste < 5) { "Die Liste beginnt noch mit Seite ${nachher.erste}" }
        assert(nachher.versatz >= 0) { "Negativer Versatz ${nachher.versatz}" }
        gleicheStelle(vorher.stelle(y), nachher.stelle(y), nachher.h, 1.5f)
    }

    @Test
    fun `am Anfang des Dokuments bleibt die Liste oben`() {
        val (i, v) = zoomZielY(Liste(2f, 0, 0).sichtbar(), 1000f, 0.5f, rand, abstand)!!
        assert(i == 0 && v == 0) { "Erwartet Seite 0 ohne Versatz, war $i/$v" }
        assert(zoomZielY(emptyList(), 500f, 2f, rand, abstand) == null) { "Ohne Seiten gibt es kein Ziel" }
    }

    @Test
    fun `waagerecht bleibt der Punkt stehen, auch aus 1x heraus`() {
        val breite = 1048f                  // Seitenbreite bei 1x, ohne Rand
        var z = 1f
        var scroll = 0
        val x = 900f                        // rechts im Bild
        val anteil = { (scroll + x - rand) / (breite * z) }
        val start = anteil()
        repeat(20) { scroll = zoomZielX(scroll, x, rand.toFloat(), 1.08f); z *= 1.08f }
        assert(abs(anteil() - start) * breite * z <= 12f) {
            "Unter dem Finger lag ${"%.3f".format(start)} der Seitenbreite, danach ${"%.3f".format(anteil())}"
        }
        assert(zoomZielX(0, 500f, rand.toFloat(), 0.5f) == 0) { "Beim Herauszoomen links ueber den Anfang hinaus gerollt" }
    }
}
