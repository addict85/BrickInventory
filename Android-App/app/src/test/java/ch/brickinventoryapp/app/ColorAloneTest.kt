package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test

/**
 * No statement depends on color alone.
 *
 * Red-green deficiency affects about eight percent of men; a statement that lies only
 * in the color (for the price alert “armed” green against gray) does not exist
 * for them.
 *
 * [LocalStatusColors] is the
 * place where color carries MEANING (success, warning, error) — unlike
 * the Material scheme that colors surfaces. Whoever uses it says
 * something with it, and that statement needs a second carrier.
 *
 * ── What the review found ────────────────────────────────────────────────────
 *
 * Seven occurrences in six files. Six already carried their statement
 * twice:
 *
 *   MonitoringScreen      job status  → icon (hourglass, check, error, pause) and status word
 *   SetupScreen           scanner     → the hint text changes along
 *   BarcodeScannerScreen  scanner     → the same change
 *   BarcodeScannerScreen  flashlight  → the button label changes
 *   PortfolioChart        development → sign and number
 *   SetDetailComponents   PnlBadge    → sign and number
 *   CsvImportBanner       count       → icon shape and label below
 *
 * The seventh did not: RateLimitRow had three levels (blue, yellow, red), and only
 * the color said which one you are in — yellow against red is exactly the pair
 * that merges. The number stands next to it, but the purpose of the
 * coloring was to catch the eye, not to inform. It now has a symbol.
 *
 * ── Why a list and not a search for „is there text next to it“ ──────────────
 *
 * Whether a text REALLY carries the statement, no pattern sees. „⏳ running“
 * carries it, a text that happens to stand next to it does not. The list is
 * therefore a claim a human made, and the test only records
 * that nobody adds a NEW place without having asked the same
 * question.
 *
 * ── Counter-checks ─────────────────────────────────────
 *
 *   WantedListScreen newly colors with LocalStatusColors — a file nobody has
 *   checked → “whoever uses status colors is on the checked list" red.
 *   The quota row itself is rendered in feature-management (QuotaWarningTest).
 */
class ColorAloneTest {

    /** The files whose color statement demonstrably has a second carrier. */
    private val checked = setOf(
        "MonitoringScreen.kt",
        "MonitoringKontingente.kt",
        "SetupQr.kt",
        "BarcodeScannerScreen.kt",
        "PortfolioChart.kt",
        "SetDetailComponents.kt",
        "CsvImportBanner.kt",
        // P&L on the set card: sign and number as with the PnlBadge.
        "GalleryCard.kt",
        // P&L badge of the finance card: fmtPercent writes the sign along.
        "FinanceSections.kt",
    )

    @Test
    fun `whoever uses status colors is on the checked list`() {
        val user = Sources.all()
            .filter { Sources.withoutComments(it.readText()).contains("LocalStatusColors.current") }
            .map { it.name }
            .toSet()
        // Self-proof: does the search find anything at all? Without that an
        // empty set would always be a subset of the list — the rule would be
        // green forever without ever looking at anything.
        assert(user.size >= 5) {
            "Only ${user.size} files use LocalStatusColors — pattern outdated?"
        }

        val newValue = (user - checked).sorted()
        assert(newValue.isEmpty()) {
            "These files newly color with LocalStatusColors:\n  " +
                newValue.joinToString("\n  ") +
                "\nColor carries MEANING there. What does the spot tell someone who " +
                "cannot tell red from green? If there is a second carrier " +
                "(word, symbol, shape), the file belongs in `checked` — and if " +
                "not, it needs to be built."
        }
        val gone = (checked - user).sorted()
        assert(gone.isEmpty()) {
            "These entries in `checked` no longer color that way: " +
                gone.joinToString(", ") + " — remove them."
        }
    }
}
