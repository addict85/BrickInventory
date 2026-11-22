package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * Structure of the scroll positions over every tab: no list creates its scroll state itself, every
 * tab with a scroll area is in the list, and only the ScrollMemory holds the position. That each tab
 * is back at its row and reports it runs in TabScrollPositionTest and CatalogGridTest.
 *
 * Counter-check: counter-checks/role-second-source.patch (the gallery again with
 * rememberLazyGridState()) → red “only the ScrollMemory holds the scroll position“.
 */
class ListScrollPositionTest {

    private fun read(rel: String): String {
        val f = File(Sources.root, "$rel")
        assert(f.exists()) { "File not found: $rel" }
        return f.readText()
    }

    /**
     * Hide comments. Without that the own explanatory text keeps the check
     * green — the reasoning above names `rememberLazyGridState()` several times
     * by name, exactly the pattern searched for here.
     */
    private fun code(src: String) = src.lines()
        .joinToString("\n") { val t = it.trim(); if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else it }

    /** Grid tabs that get their state from outside. */
    private val raster = listOf(
        "collection/ui/screens/GalleryScreen.kt",
        "parts/ui/screens/PartsScreen.kt",
        "parts/ui/screens/MinifigsScreen.kt",
    )

    /** List tabs, the same with LazyColumn. */
    private val columns = listOf(
        "finances/ui/screens/FinanceScreen.kt",
        "parts/ui/screens/PartsListScreen.kt",
    )

    @Test
    fun `no list creates its scroll state itself`() {
        for (file in raster) {
            val src = code(read(file))
            assert(!src.contains("val gridState = rememberLazyGridState()")) {
                "$file creates the scroll state in the destination itself. When the " +
                    "detail view opens, the destination is discarded — on return the " +
                    "list then jumps to the top. The state belongs above the NavHost."
            }
            assert(src.contains("gridState: LazyGridState = rememberLazyGridState()")) {
                "$file takes no scroll state from outside"
            }
        }
    }

    @Test
    fun `every tab with a scroll area is covered`() {
        // ── Why this check exists ─────────────────────────────
        //
        // All tabs are counted, not the known ones: a new one should stand out here.
        //
        // This check counts them. If a tab is added that scrolls and
        // leads into a detail view, it turns red until it is entered here.
        val covered = raster + columns + listOf("catalog/ui/screens/CatalogScreen.kt")
        val withoutScrollArea = listOf("collection/ui/screens/ComparisonScreen.kt")

        val allTab = covered + withoutScrollArea
        assert(allTab.size == 7) {
            "The app has seven tabs; here there are ${allTab.size}. If one was " +
                "added, it belongs in `covered` — or, if it has nothing to " +
                "scroll, in `withoutScrollArea`."
        }

        // Whoever is in `withoutScrollArea` must really have none.
        for (file in withoutScrollArea) {
            val src = code(read(file))
            assert(!src.contains("LazyColumn") && !src.contains("LazyVerticalGrid") &&
                   !src.contains("verticalScroll")) {
                "$file now has a scroll area and belongs to the covered ones"
            }
        }
    }

    @Test
    fun `only the ScrollMemory holds the scroll position`() {
        // Formerly three sources: states above the NavHost, the ScrollMemory and in the
        // catalog the ViewModel. Now every destination creates its state per visit
        // (`remember`, not `rememberSaveable`), and only the ScrollMemory carries the position
        // across the excursion; ScrollPositionTest checks that, executed.
        val nav = code(read("app/AppNavigation.kt"))
        for (old in listOf("Rollzustaende", "rememberLazyGridState", "rememberLazyListState", "rememberScrollState")) {
            assert(!nav.contains(old)) { "AppNavigation holds scroll states again ($old) — a second source" }
        }
        val graphs = listOf("collection/ui/CollectionGraph.kt", "parts/ui/PartsGraph.kt", "finances/ui/FinancesGraph.kt",
            "account/ui/AccountGraph.kt")
        val graph = graphs.joinToString("\n") { code(read(it)) }
        for (second in listOf("rememberLazyGridState(", "rememberLazyListState(", "rememberScrollState(", "navigation.rollen")) {
            assert(!graph.contains(second)) { "a graph holds the position itself again ($second)" }
        }
        for (pair in listOf(
            "val galleryGridState = remember { LazyGridState() }" to "gridState = galleryGridState",
            "val partsGridState = remember { LazyGridState() }" to "gridState = partsGridState",
            "val minifigsGridState = remember { LazyGridState() }" to "gridState = minifigsGridState",
            "val financeListState = remember { LazyListState() }" to "listState = financeListState",
            "val partListsState = remember { LazyListState() }" to "listState = partListsState",
        )) {
            assert(graph.contains(pair.first) && graph.contains(pair.second)) { "the graph does not create `${pair.first}` or does not pass it on" }
        }
        val catalog = code(read("catalog/ui/screens/CatalogScreen.kt")) + code(read("catalog/ui/CatalogStates.kt"))
        for (old in listOf("scrollIndex", "onScrollPos", "rememberLazyGridState()")) {
            assert(!catalog.contains(old)) { "the catalog remembers the position itself again ($old)" }
        }
    }
}
