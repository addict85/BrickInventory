package ch.brickinventoryapp.ui

import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.util.numbersLocale
import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.ui.util.fmtAmount
import ch.brickinventoryapp.ui.util.fmtInput
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtMoneyOrDash
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.util.Locale

/**
 * Numbers and amounts come from ONE version — and it follows the app language.
 *
 * Counter-checks part 3:
 *   A  numbersLocale() fixed back to de-CH/en-GB → red „de-DE schreibt Punkt und Komma …“ and „ohne passende Landesform …“ (de-AT)
 *   B  the country taken without a language check → red „ohne passende Landesform …“
 *      (de with device en-US gave de-US)
 *   C  isGroupingUsed not turned off in fmtInput() → red „ein Eingabefeld bekommt den Betrag ohne Tausendertrennung zurück“
 *   D  "%.2f".format back in AcquisitionManagementScreen.kt → red „keine Ansicht setzt Betrag und Währung selbst zusammen“
 */
class NumberFormatTest {

    private fun read(rel: String) =
        File(Sources.root, "$rel").readText()

    /** Hide comments line by line — otherwise the explanatory text itself keeps the check green. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    // ── Part 1: the rule ────────────────────────────────────────────────────

    @Test
    fun `no view assembles amount and currency itself`() {
        val screens = listOf(
            "app/AppNavigation.kt",
            "parts/ui/screens/PartsScreen.kt",
            "parts/ui/screens/PartsFilterSheet.kt",
            "parts/ui/screens/PartsCard.kt",
            "finances/ui/screens/FinanceScreen.kt",
            "collection/ui/screens/SetDetailScreen.kt",
            "shared/ui/SetDetailComponents.kt",
            "shared/ui/ManualItemComposables.kt",
            "parts/ui/screens/ManualItemDetailScreen.kt",
            "collection/ui/screens/AcquisitionManagementScreen.kt",
            "collection/ui/screens/GalleryScreen.kt",
            "collection/ui/screens/GalleryFilter.kt",
            "collection/ui/screens/GalleryCard.kt",
            "collection/ui/screens/GalleryRecord.kt",
            "account/ui/screens/SettingsAlarms.kt",
        )
        for (f in screens) {
            val c = code(read(f))
            assert(!c.contains("fmtSwissAmount") && !c.contains("fmtSwissInt")) {
                "$f still uses the old version nailed to de-CH"
            }
            assert(!c.contains("Currency.getInstance")) {
                "$f builds the currency symbol itself — that belongs in fmtMoney(), " +
                    "otherwise it stands before the amount here and after it elsewhere"
            }
            // The dollar sign is written as ${'$'} and not as a backslash-$.
            assert(!Regex("""\{[^}]*fmt[A-Za-z]*\([^)]*\)[^}]*\}\s*\${'$'}currency""").containsMatchIn(c)) {
                "$f appends the currency code by hand to a formatted amount"
            }
            assert(!c.contains("\"%,d\".format")) {
                "$f formats a number by hand instead of via fmtInt()"
            }
            assert(!c.contains("\"%.2f\".format")) {
                "$f formats an amount in the device language instead of via fmtAmount()/fmtInput()"
            }
        }
    }

    /**
     * The placement of symbol and amount is up to the locale (getCurrencyInstance);
     * assembled by hand, the symbol would stand on the same side everywhere.
     * Counter-check amount-symbol-by-hand (symbol before fmtAmount(); kotlinc) → red here.
     */
    @Test
    fun `the opposite direction stays the platform's business`() {
        withDevice("de-DE") { assertEquals("812,50\u00A0€", fmtMoney(812.5, CurrencyCode("EUR"))) }
        withDevice("en-GB") { assertEquals("€812.50", fmtMoney(812.5, CurrencyCode("EUR"))) }
    }

    // ── Part 2: the result ─────────────────────────────────────────────────

    @Test
    fun `amounts contain number and currency`() {
        val s = fmtMoney(1234.5, CurrencyCode("CHF"))
        assert(s.contains("1") && s.contains("234")) { "the amount is missing: $s" }
        assert(s.contains("CHF") || s.contains("Fr")) { "the currency is missing: $s" }
        // Two decimal places, as in the web app (minimumFractionDigits: 2).
        assert(Regex("""[.,]\d{2}(\D|$)""").containsMatchIn(s)) {
            "the two decimal places are missing: $s"
        }
    }

    @Test
    fun `an unknown currency code does not break the display`() {
        // Happens when the server delivers a code the platform doesn't
        // know. It used to fall into a catch that produced a SECOND
        // spelling — now the fallback is part of the same version.
        val s = fmtMoney(10.0, CurrencyCode("XYZ123"))
        assert(s.contains("10")) { "the amount must appear even without a known currency: $s" }
    }

    @Test
    fun `a missing amount gives a dash`() {
        assertEquals("—", fmtMoneyOrDash(null as String?, CurrencyCode("CHF")))
        assertEquals("—", fmtMoneyOrDash("keine Zahl", CurrencyCode("CHF")))
        assert(fmtMoneyOrDash("12.5", CurrencyCode("CHF")).contains("12")) { "a valid value must get through" }
    }

    @Test
    fun `numbers without currency carry a thousands separator`() {
        val i = fmtInt(60000)
        assert(i.length > 5) { "60000 should be separated, was: $i" }
        assert(i.contains("60")) { "unerwartete Ausgabe: $i" }
        val a = fmtAmount(1234.5)
        assert(Regex("""[.,]\d{2}$""").containsMatchIn(a)) { "two decimal places expected: $a" }
    }

    // ── Part 3: the locale follows the device, as in the web ──────────────

    private fun withDevice(tag: String, block: () -> Unit) {
        val before = Locale.getDefault()
        Locale.setDefault(Locale.forLanguageTag(tag))
        try { block() } finally { Locale.setDefault(before) }
    }

    @Test
    fun `de-DE writes point and comma, de-CH apostrophe and point`() {
        withDevice("de-DE") { assertEquals("4.894,77", fmtAmount(4894.77)) }
        withDevice("de-CH") { assertEquals("4\u2019894.77", fmtAmount(4894.77)) }
        withDevice("en-US") { assertEquals("4,894.77", fmtAmount(4894.77)) }
    }

    @Test
    fun `an input field gets the amount back without thousands separator`() {
        withDevice("de-DE") { assertEquals("4894,77", fmtInput(4894.77)) }
        withDevice("de-CH") { assertEquals("4894.77", fmtInput(4894.77)) }
        // This is how AcquisitionManagementRow reads the field on save.
        withDevice("de-DE") { assertEquals(4894.77, fmtInput(4894.77).replace(',', '.').toDouble(), 0.0) }
    }

    @Test
    fun `without a matching country form de-CH and en-GB apply`() {
        val de = Locale.forLanguageTag("de")
        assertEquals("de-CH", numbersLocale(de, Locale.forLanguageTag("en-US")).toLanguageTag())
        assertEquals("de-CH", numbersLocale(de, de).toLanguageTag())
        assertEquals("en-GB", numbersLocale(Locale.forLanguageTag("fr-FR"), Locale.forLanguageTag("fr-FR")).toLanguageTag())
        assertEquals("the country comes from the device, the language from the app",
            "de-AT", numbersLocale(de, Locale.forLanguageTag("de-AT")).toLanguageTag())
        assertEquals("en-GB", numbersLocale(Locale.forLanguageTag("en"), Locale.forLanguageTag("de-DE")).toLanguageTag())
    }

    /**
     * Like Intl in the web: „CHF 812.50“ with a fixed space, never „CHF812.50“.
     * Counter-check: withCurrencyGap() removed from fmtMoney →
     * red (en-GB gave „CHF812.50“).
     */
    @Test
    fun `currency code and amount stand with a non-breaking space`() {
        withDevice("en-GB") {
            assertEquals("CHF\u00A0812.50", fmtMoney(812.5, CurrencyCode("CHF")))
            assertEquals("-CHF\u00A012.00", fmtMoney(-12.0, CurrencyCode("CHF")))
            assertEquals("€812.50", fmtMoney(812.5, CurrencyCode("EUR")))
        }
        withDevice("de-CH") {
            val s = fmtMoney(812.5, CurrencyCode("CHF"))
            assertEquals("CHF\u00A0812.50", s.replace(' ', '\u00A0'))
            assert(!s.contains("\u00A0\u00A0") && !s.contains("  ")) { "double space: $s" }
        }
    }
}
