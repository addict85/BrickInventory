package ch.brickinventoryapp.catalog

import ch.brickinventoryapp.catalog.ui.CatalogYearMath
import ch.brickinventoryapp.catalog.ui.viewmodel.VIEWPORT_REST_MS
import ch.brickinventoryapp.catalog.ui.viewmodel.ViewportLoader
import ch.brickinventoryapp.data.catalog.CATALOG_PAGE_SIZE
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * One drag on the year bar fetches ONE page, not a hundred.
 *
 * ── What was measured before anything was changed ─────────────────────────
 * The database looked suspicious at first — an `ORDER BY year DESC … LIMIT 60
 * OFFSET <large>` gets expensive on big jumps. Measured against 25,000 sets with
 * a realistic year distribution: page 1 takes 1.0 ms, the
 * middle 9.2 ms, the end 19.9 ms, the COUNT(*) per page 1.8 ms. Even the
 * worst case stays well under a second. The seconds do NOT
 * come from there — and the web app jumps instantly with the same database.
 *
 * ── The cause, and my own misstep along the way ───────────────────────────────
 * There are TWO paths by which a page gets requested:
 *
 *   1. the bar's callback (`onScrollTo`) — it runs on every
 *      touch point;
 *   2. the viewport loader — it runs whenever the visible
 *      window changes.
 *
 * Both paths are debounced, path 2 included: the bar really SCROLLS the list
 * to every intermediate position (its callback sets a
 * `gridState.scrollToItem` via `state.scrollTo`). Path 2 thus saw every single
 * point of the drag and would otherwise request three pages there.
 *
 * The stillness now lives in the viewport loader. It covers both paths, because
 * both end up there. That's exactly what the web app has always done
 * (`js/katalog.js`, `_ladeSichtbareSeiten`, 150 ms) — and exactly why
 * the web app is fast.
 *
 * ── How it's checked ───────────────────────────────────────────────────────
 * The stillness lives in the ViewModel (Sichtfensterlader) and runs
 * here with StandardTestDispatcher: one drag with a hundred windows, virtual time,
 * counted fetches. That the bar itself only scrolls runs in CatalogGridTest.
 *
 * Counter-checks:
 *   A  `collectLatest` replaced by `collect`
 *      (counter-checks/sichtfenster-ohne-entprellung.patch) → red "der Sichtfenster-Lader wartet …" (every window of the drag gets loaded)
 *   B  `delay(restMs)` removed → red, the same case (loads before the stillness)
 *   C  the lead `(of - 1)..(until + 1)` shortened to `of..until` → red, the same case
 */
class CatalogJumpDebouncedTest {

    @Test
    fun `a drag over the bar touches very many pages`() {
        // An ordinary phone: bar at the full height, handle 36dp
        // at triple density. The catalog has around 25,000 sets.
        val height = 1800
        val handle = 108
        val total = 25_000

        // Every pixel the finger sweeps over on the way from top to
        // bottom — exactly the points where the list keeps scrolling
        // and the viewport loader sees a new window.
        val pages = (0..height).map { y ->
            val share = CatalogYearMath.shareFrom(y.toFloat(), height, handle)
            CatalogYearMath.numberFrom(share, total) / CATALOG_PAGE_SIZE + 1
        }.toSet()

        // MEASURED, not asserted: the path touches EVERY page of the catalog
        // — 417 of 417. 25,000 sets sit on 1692 pixels of track, so around
        // 15 per pixel; a page boundary is therefore crossed roughly every four pixels.
        //
        // How many fetches that turns into is decided by the number of
        // touch points: two consecutive ones are, at any ordinary
        // drag speed, more than four pixels apart,
        // so practically every one hits a different page. At 60 to 120
        // points per second that's over a hundred fetches for one drag —
        // each for over 60 sets, none canceled, and the API client allows
        // only a handful at once. The target page then sits behind
        // all the others in the queue: three to five seconds.
        val totalPages = (total - 1) / CATALOG_PAGE_SIZE + 1
        assert(pages.size >= totalPages - 1) {
            "The way touches only ${pages.size} of $totalPages pages. Then " +
                "debouncing would be the wrong fix, and the cause would lie " +
                "elsewhere — recalculate before adjusting a number here."
        }
        assert(totalPages > 100) { "Catalog too small for this statement — calculation outdated?" }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `the viewport loader waits until the list stands still`() = runTest {
        val loaded = mutableListOf<Int>()
        val area = CoroutineScope(StandardTestDispatcher(testScheduler))
        val loader = ViewportLoader(area, VIEWPORT_REST_MS) { loaded += it }
        // One drag across the bar: a hundred windows, one every 10 ms, page by page.
        for (page in 1..100) {
            loader.visible(page, page + 1)
            advanceTimeBy(10)
        }
        assertEquals("nothing is loaded during the drag", emptyList<Int>(), loaded)
        advanceUntilIdle()
        assertEquals("only the last window, with one page of lead in both directions",
            listOf(99, 100, 101, 102), loaded)
        // Page 1 has no predecessor: no fetch for page 0.
        loaded.clear()
        loader.visible(1, 1)
        advanceUntilIdle()
        assertEquals(listOf(1, 2), loaded)
        area.cancel()
    }
}
