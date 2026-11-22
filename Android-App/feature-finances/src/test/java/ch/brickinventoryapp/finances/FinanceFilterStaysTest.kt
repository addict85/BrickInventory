package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.FinanceUiState
import org.junit.Test
import ch.brickinventoryapp.testing.Sources

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
            "Ohne Einschraenkung muessen alle drei Zeilenarten sichtbar sein"
        }
    }

    @Test
    fun `the filter is additive`() {
        val z = FinanceUiState()
            .withToggledCategory("sets")
            .withToggledCategory("figs")

        assert(z.categories == setOf("sets", "figs")) {
            "Zwei Klicks sollen sich haeufen, nicht einander ersetzen: ${z.categories}"
        }
        assert(z.shows("sets") && z.shows("figs")) { "Beide gewaehlten Arten bleiben sichtbar" }
        assert(!z.shows("parts")) { "Was nicht gewaehlt ist, faellt weg" }
    }

    @Test
    fun `the same kind clicked twice removes it again`() {
        val z = FinanceUiState()
            .withToggledCategory("parts")
            .withToggledCategory("parts")

        assert(z.categories.isEmpty()) { "Der zweite Klick raeumt die Wahl wieder weg" }
        // And the empty set again means ALL — not "nothing". A view
        // that stayed empty after deselecting would not be a filter but a
        // blank page.
        assert(z.shows("sets") && z.shows("parts") && z.shows("figs")) {
            "Die leere Auswahl muss wieder alles zeigen"
        }
    }

    @Test
    fun `the screen does not hold the filter itself`() {
        val src = Sources.withoutComments(
            Sources.read("finances/ui/screens/FinanceScreen.kt"))

        assert(!Regex("""remember\s*\{\s*mutableStateOf\("all"\)""").containsMatchIn(src)) {
            "Der Kategoriefilter liegt wieder in einem remember des Bildschirms — " +
                "damit ist er nach jedem Ausflug in einen Detail-Bildschirm weg"
        }
        assert(src.contains("financeState.shows(")) {
            "Der Bildschirm soll die Sichtbarkeit aus dem Zustand lesen"
        }
        // The rule "empty means all" may be written down only ONCE. Previously
        // it stood three times in the screen (showSets/showParts/showFigs).
        assert(!src.contains("categories.isEmpty() ||")) {
            "Die Regel „leere Auswahl heisst alle\" steht wieder im Bildschirm statt " +
                "in FinanceUiState.shows()"
        }
    }
}
