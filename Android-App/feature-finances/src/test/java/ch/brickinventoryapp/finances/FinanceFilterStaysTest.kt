package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.FinanceUiState
import ch.brickinventoryapp.testing.Sources
import org.junit.Test

/**
 * The category filter of finances stays put — and can be combined.
 *
 * ── What was wrong with it ───────────────────────────────────────────────────
 * The filter lived in the screen:
 *
 *     val activeCategory = remember { mutableStateOf("alle") }
 *
 * `remember` holds a value across a recomposition — not across
 * leaving the composition. A click on a row leads into a different
 * screen, the finances tab leaves the composition, and on
 * returning `remember` starts over: "alle".
 *
 * This is the same rule as for the list filters
 * (ListFilterInStateTest): a filter that restricts a view
 * belongs in that view's state. `rememberSaveable` would have been the smaller
 * answer and would still be wrong — it survives a process death,
 * but not leaving the composition.
 *
 * ── Two halves, because one alone can quietly become wrong ────────────────
 *  1. ON BEHAVIOR: the quantity math is correct — adding, removing, and
 *     an empty selection shows everything.
 *  2. ON THE SOURCE: the screen does not hold the filter itself again.
 *     Half 1 would stay green while the filter got lost again.
 */
class FinanceFilterStaysTest {

    @Test
    fun `an empty selection shows everything`() {
        val z = FinanceUiState()
        assert(z.shows("sets") && z.shows("parts") && z.shows("figs")) {
            "without a restriction all three row kinds must be visible"
        }
    }

    @Test
    fun `the filter is additive`() {
        val z = FinanceUiState()
            .withToggledCategory("sets")
            .withToggledCategory("figs")

        assert(z.categories == setOf("sets", "figs")) {
            "two clicks should add up, not replace each other: ${z.categories}"
        }
        assert(z.shows("sets") && z.shows("figs")) { "both chosen kinds stay visible" }
        assert(!z.shows("parts")) { "what is not chosen drops out" }
    }

    @Test
    fun `the same kind clicked twice removes it again`() {
        val z = FinanceUiState()
            .withToggledCategory("parts")
            .withToggledCategory("parts")

        assert(z.categories.isEmpty()) { "the second click clears the choice again" }
        // And the empty set again means ALL — not "nothing". A view
        // that stayed empty after deselecting would not be a filter but a
        // blank page.
        assert(z.shows("sets") && z.shows("parts") && z.shows("figs")) {
            "the empty selection must show everything again"
        }
    }

    @Test
    fun `the screen does not hold the filter itself`() {
        val src = Sources.withoutComments(
            Sources.read("finances/ui/screens/FinanceScreen.kt"))

        assert(!Regex("""remember\s*\{\s*mutableStateOf\("all"\)""").containsMatchIn(src)) {
            "The category filter lies in a remember of the screen again — " +
                "so it is gone after every trip into a detail screen"
        }
        assert(src.contains("financeState.shows(")) {
            "the screen should read the visibility from the state"
        }
        // The rule "empty means all" may be written down only ONCE. Previously
        // it stood three times in the screen (showSets/showParts/showFigs).
        assert(!src.contains("categories.isEmpty() ||")) {
            "The rule “empty selection means all” stands in the screen again instead of " +
                "in FinanceUiState.shows()"
        }
    }
}
