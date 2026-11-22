package ch.brickinventoryapp.ui

import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.ui.util.appNumberLocale
import ch.brickinventoryapp.ui.util.fmtPercent
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.text.NumberFormat
import java.util.Locale

/**
 * Percentages come from fmtPercent(): one decimal place, sign when ≠ 0,
 * symbol and spacing per the app language.
 *
 * Counter-checks:
 *   A  rounding removed before the sign → red „was auf null rundet, …“
 *      ("-0.0%")
 *   B  the plus left out → red „ein Gewinn trägt ein Plus …“
 *   C  getNumberInstance instead of getPercentInstance (number without symbol) → red
 *      „ein Gewinn …“ and „ein Verlust …“
 *   D  "%.1f%%".format back in PortfolioChart.kt → red „kein Bildschirm …“
 */
class PercentFormatTest {

    private val before = Locale.getDefault()

    @After
    fun tearDown() = Locale.setDefault(before)

    /** What the platform makes of a ratio for the app language. */
    private fun platform(share: Double) = NumberFormat.getPercentInstance(appNumberLocale())
        .apply { minimumFractionDigits = 1; maximumFractionDigits = 1 }.format(share)

    @Test
    fun `a profit carries a plus and one decimal place`() {
        for (language in listOf(Locale.GERMAN, Locale.ENGLISH)) {
            Locale.setDefault(language)
            assertEquals("+" + platform(0.123), fmtPercent(12.345))
            assertTrue(fmtPercent(12.345).contains("12") && fmtPercent(12.345).contains("%"))
        }
    }

    @Test
    fun `a loss carries the platform's minus`() {
        Locale.setDefault(Locale.ENGLISH)
        assertEquals(platform(-0.045), fmtPercent(-4.5))
        assertTrue(fmtPercent(-4.5).startsWith("-"))
    }

    @Test
    fun `what rounds to zero stands without sign`() {
        Locale.setDefault(Locale.ENGLISH)
        assertEquals(platform(0.0), fmtPercent(0.0))
        assertEquals(platform(0.0), fmtPercent(-0.04))
        assertEquals(platform(0.0), fmtPercent(0.04))
    }

    @Test
    fun `the language decides about the separator`() {
        Locale.setDefault(Locale.GERMAN)
        val de = fmtPercent(1234.5)
        Locale.setDefault(Locale.ENGLISH)
        val en = fmtPercent(1234.5)
        assertTrue("de-CH und en-GB trennen Tausender verschieden: $de / $en", de != en)
    }

    @Test
    fun `no screen formats percentages itself`() {
        val screens = Sources.below("ui/screens") + Sources.below("shared/ui")
        val ofHand = Regex("""%\.1f%%|"%\.1f"\s*,\s*pct|\+\s*" %"""")
        val hits = screens.filter { ofHand.containsMatchIn(it.readText()) }.map { it.name }
        assertEquals("Prozente laufen über fmtPercent()", emptyList<String>(), hits)
    }
}
