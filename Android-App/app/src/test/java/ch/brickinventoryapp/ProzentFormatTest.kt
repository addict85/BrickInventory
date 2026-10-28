package ch.brickinventoryapp

import ch.brickinventoryapp.util.appNumberLocale
import ch.brickinventoryapp.util.fmtProzent
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.text.NumberFormat
import java.util.Locale

/**
 * Prozente kommen aus fmtProzent(): eine Nachkommastelle, Vorzeichen bei ≠ 0,
 * Zeichen und Abstand nach der App-Sprache.
 *
 * Gegenproben (28.10.2026, gemessen mit kotlinc gegen util/NumberFormatUtils.kt):
 *   A  das Runden vor dem Vorzeichen entfernt → rot „was auf null rundet, …“
 *      („-0.0%“)
 *   B  das Plus weggelassen → rot „ein Gewinn trägt ein Plus …“
 *   C  getNumberInstance statt getPercentInstance (Zahl ohne Zeichen) → rot
 *      „ein Gewinn …“ und „ein Verlust …“
 *   D  in PortfolioChart.kt wieder "%.1f%%".format → rot „kein Bildschirm …“
 */
class ProzentFormatTest {

    private val vorher = Locale.getDefault()

    @After
    fun zu() = Locale.setDefault(vorher)

    /** Was die Plattform für die App-Sprache aus einem Anteil macht. */
    private fun plattform(anteil: Double) = NumberFormat.getPercentInstance(appNumberLocale())
        .apply { minimumFractionDigits = 1; maximumFractionDigits = 1 }.format(anteil)

    @Test
    fun `ein Gewinn traegt ein Plus und eine Nachkommastelle`() {
        for (sprache in listOf(Locale.GERMAN, Locale.ENGLISH)) {
            Locale.setDefault(sprache)
            assertEquals("+" + plattform(0.123), fmtProzent(12.345))
            assertTrue(fmtProzent(12.345).contains("12") && fmtProzent(12.345).contains("%"))
        }
    }

    @Test
    fun `ein Verlust traegt das Minus der Plattform`() {
        Locale.setDefault(Locale.ENGLISH)
        assertEquals(plattform(-0.045), fmtProzent(-4.5))
        assertTrue(fmtProzent(-4.5).startsWith("-"))
    }

    @Test
    fun `was auf null rundet, steht ohne Vorzeichen`() {
        Locale.setDefault(Locale.ENGLISH)
        assertEquals(plattform(0.0), fmtProzent(0.0))
        assertEquals(plattform(0.0), fmtProzent(-0.04))
        assertEquals(plattform(0.0), fmtProzent(0.04))
    }

    @Test
    fun `die Sprache entscheidet ueber das Trennzeichen`() {
        Locale.setDefault(Locale.GERMAN)
        val de = fmtProzent(1234.5)
        Locale.setDefault(Locale.ENGLISH)
        val en = fmtProzent(1234.5)
        assertTrue("de-CH und en-GB trennen Tausender verschieden: $de / $en", de != en)
    }

    @Test
    fun `kein Bildschirm formatiert Prozente selbst`() {
        val schirme = java.io.File("src/main/java/ch/brickinventoryapp/ui/screens").listFiles().orEmpty()
        val vonHand = Regex("""%\.1f%%|"%\.1f"\s*,\s*pct|\+\s*" %"""")
        val treffer = schirme.filter { vonHand.containsMatchIn(it.readText()) }.map { it.name }
        assertEquals("Prozente laufen über fmtProzent()", emptyList<String>(), treffer)
    }
}
