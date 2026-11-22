package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * The year bar in the catalog JUMPS, it does not filter.
 *
 * ── Why this rebuilds the list ───────────────────────────────────────────────
 * Previously the list hung on endless scroll: page 1, 2, 3 … appended. Whoever jumps to
 * year 2005 lands in the middle of the stock — and with an appended list
 * there is simply nothing there, neither before nor after.
 *
 * The view therefore holds ALL `total` places and loads the page on which a
 * place that became visible lies — forwards, backwards and after a jump.
 * What is not there yet stands as a placeholder.
 *
 * ── What is checked here ─────────────────────────────────────────────────────
 * The RULES, not the look:
 *   • The bar scrolls the list, it does not filter.
 *   • The list counts via `total`, not via the loaded subset.
 *   • Loading happens in BOTH directions.
 *
 * The explicit year filter (chip and selection sheet) stays: the BAR
 * scrolls, filtering is a separate path.
 */
class CatalogScrubberTest {

    private fun read(rel: String) =
        File(Sources.root, "$rel").readText()

    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `the bar scrolls instead of filtering`() {
        val s = code(read("catalog/ui/screens/CatalogScreen.kt"))
        val i = s.indexOf("YearScrubber(")
        assert(i > 0) { "the bar is missing entirely" }
        val call = s.substring(i, minOf(i + 700, s.length))
        // As in the web app the bar scrolls to
        // a POSITION instead of jumping to the first set of a year. The
        // difference to the filter stays the same: a filter throws the other
        // years away, scrolling leaves them in place.
        assert(call.contains("onScrollTo = ")) {
            "The bar does not scroll the list — then it is a filter or a jump " +
                "again, but not the web app's bar"
        }
        assert(!call.contains("onYearSelected") && !call.contains("selectedYear")) {
            "the bar hangs on the year again instead of on the position in the list"
        }
        // What is needed at the new position is fetched by the viewport loader.
        //
        // At first `onEnsurePage(` stood here — the fetch directly in the
        // bar's callback, which runs at EVERY touch point. After that
        // `zielSeite =` stood here, a remembered jump target with its own
        // debounced fetch. That too was the wrong layer: the bar
        // really scrolls the list to every intermediate position, and the
        // viewport loader kept requesting pages there unchanged.
        //
        // Now the callback only passes the position on, and the rest
        // lives in the viewport loader — both paths end there. The rule for it
        // stands WITH the measurement in CatalogJumpDebouncedTest, not here once
        // more; at this place it only remains that NO loading happens here.
        assert(!call.contains("onEnsurePage")) {
            "The bar loads by itself again — that is one fetch per " +
                "Beruehrungspunkt, siehe CatalogJumpDebouncedTest"
        }
        // The explicit filter stays.
        assert(s.contains("onYearChange")) {
            "the year filter (chip and picker sheet) must not have disappeared too"
        }
    }

    @Test
    fun `the list holds all places and loads in both directions`() {
        val s = code(Sources.screen("catalog/ui/screens/CatalogScreen.kt"))
        assert(s.contains("items(count = state.total")) {
            "The list counts over the loaded subset instead of the whole result — " +
                "then there is nothing at the jump position"
        }
        assert(s.contains("state.loadedPages[page]")) {
            "the places are not served from the loaded pages"
        }
        // The prefetch in both directions is checked by CatalogJumpDebouncedTest, executed
        // on the viewport loader (pages 99..102 for the window 100..101).
        assert(s.contains("CatalogPlaceholderCard()")) { "the placeholder is missing" }
        assert(Regex("""CatalogPlaceholderCard[\s\S]{0,400}\.height\(""").containsMatchIn(s)) {
            "The placeholder has no fixed height — the list jumps as soon as the " +
                "page arrives, and the jump lands beside the target"
        }
    }

    @Test
    fun `the scroll position survives the switch to the detail page`() {
        // The list leaves the composition when switching to the detail, and its length comes
        // only later. The ScrollMemory holds the position as for every tab; the list is
        // ready as soon as `total` is there, because the places count via the total.
        val s = code(read("catalog/ui/screens/CatalogScreen.kt"))
        assert(s.contains("ScrollPositionKeeper(CatalogTarget.Catalog.rollKey, gridState, ready = state.total > 0")) {
            "The restore does not hang on state.total — before the length " +
                "arrives there is no position to jump to"
        }
        // How the marker jumps back is checked by ScrollPositionTest, executed; the forgetting
        // on a filter change by CatalogViewModelTest.
    }
}
