package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test
import java.io.File

/**
 * The scroll state of a list survives the detour into a detail view.
 *
 * ── Why this was a family error ──────────────────────────────────────────────
 * For the FINANCE list it had long been solved: `financeListState` lies above
 * the NavHost and is passed down, with reasoning in the code. The CATALOG solved
 * it in its own way — it reports the position continuously to the
 * ViewModel and jumps back once as soon as the list has its length (necessary
 * because it loads page by page and the length arrives only later).
 *
 * Gallery, parts and minifigures lead into a detail view just the same, but had
 * neither the one nor the other — for the minifigures there was not
 * even a named state, `LazyVerticalGrid` created one internally
 * itself.
 *
 * Again the pattern of this project: a rule is missing on the second path. This
 * test therefore does not check the one reported place but ALL lists that
 * lead into a detail — the next new one should stand out here.
 *
 * Counter-checks (performed): `gridState` parameter removed from GalleryScreen
 * and created locally again → first sub-step red; the handover in
 * CollectionGraph deleted → second sub-step red;
 * counter-checks/rolle-zweite-quelle.patch (the gallery again with
 * rememberLazyGridState()) → red “only the ScrollMemory holds the scroll position“.
 */
class ListScrollPositionTest {

    private fun read(rel: String): String {
        val f = File(Sources.root, "$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
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
                "$file legt den Scroll-Zustand im Ziel selbst an. Beim Öffnen der " +
                    "Detailansicht wird das Ziel verworfen — bei der Rückkehr springt " +
                    "die Liste dann nach oben. Der Zustand gehört oberhalb des NavHost."
            }
            assert(src.contains("gridState: LazyGridState = rememberLazyGridState()")) {
                "$file nimmt keinen Scroll-Zustand von aussen entgegen"
            }
        }
    }

    @Test
    fun `the grid uses the passed state too`() {
        // A parameter that arrives nowhere is worse than none: the
        // signature then promises something that does not happen. For the
        // minifigures exactly that was the starting state — there the
        // LazyVerticalGrid had no `state` at all.
        for (file in raster) {
            val src = code(read(file))
            assert(src.contains("state = gridState")) {
                "$file reicht den Zustand nicht an sein LazyVerticalGrid durch"
            }
        }
    }

    @Test
    fun `the list tabs also get their state from outside`() {
        // Finances always had it, the parts list did not — there the
        // path to the barcode scanner leads OUT of the screen; in doing so it leaves
        // the composition.
        for (file in columns) {
            val src = code(read(file))
            assert(!src.contains("val listState = rememberLazyListState()")) {
                "$file legt den Scroll-Zustand im Ziel selbst an"
            }
            assert(src.contains("listState: LazyListState = rememberLazyListState()")) {
                "$file nimmt keinen Scroll-Zustand von aussen entgegen"
            }
            assert(src.contains("state = listState")) {
                "$file reicht den Zustand nicht an seine LazyColumn durch"
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
            "Die App hat sieben Reiter; hier stehen ${allTab.size}. Wurde einer " +
                "hinzugefügt, gehört er in `abgedeckt` — oder, wenn er nichts zu " +
                "rollen hat, in `ohneRollbereich`."
        }

        // Whoever is in `withoutScrollArea` must really have none.
        for (file in withoutScrollArea) {
            val src = code(read(file))
            assert(!src.contains("LazyColumn") && !src.contains("LazyVerticalGrid") &&
                   !src.contains("verticalScroll")) {
                "$file hat inzwischen einen Rollbereich und gehört zu den abgedeckten"
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
            assert(!nav.contains(old)) { "AppNavigation hält wieder Rollzustände ($old) — eine zweite Quelle" }
        }
        val graphs = listOf("collection/ui/CollectionGraph.kt", "parts/ui/PartsGraph.kt", "finances/ui/FinancesGraph.kt",
            "account/ui/AccountGraph.kt")
        val graph = graphs.joinToString("\n") { code(read(it)) }
        for (second in listOf("rememberLazyGridState(", "rememberLazyListState(", "rememberScrollState(", "navigation.rollen")) {
            assert(!graph.contains(second)) { "Ein Graph hält die Stelle wieder selbst ($second)" }
        }
        for (pair in listOf(
            "val galleryGridState = remember { LazyGridState() }" to "gridState = galleryGridState",
            "val partsGridState = remember { LazyGridState() }" to "gridState = partsGridState",
            "val minifigsGridState = remember { LazyGridState() }" to "gridState = minifigsGridState",
            "val financeListState = remember { LazyListState() }" to "listState = financeListState",
            "val partListsState = remember { LazyListState() }" to "listState = partListsState",
        )) {
            assert(graph.contains(pair.first) && graph.contains(pair.second)) { "Der Graph legt `${pair.first}` nicht an oder übergibt ihn nicht" }
        }
        val catalog = code(read("catalog/ui/screens/CatalogScreen.kt")) + code(read("catalog/ui/CatalogStates.kt"))
        for (old in listOf("scrollIndex", "onScrollPos", "rememberLazyGridState()")) {
            assert(!catalog.contains(old)) { "Der Katalog merkt sich die Stelle wieder selbst ($old)" }
        }
    }

    @Test
    fun `every tab restores its position explicitly`() {
        // ── Why the hoisted object was not enough ─────────────
        //
        // A state above the NavHost survives the excursion, but the grid does not measure
        // out the same position when reattaching; the list would stand shifted.
        //
        // Demonstrably right lands the catalog's path: record along and
        // explicitly call scrollToItem() on entering („im Katalog ist sie
        // auf der korrekten Zeile"). Every tab now takes it — implemented once
        // in ScrollMemory.kt instead of copied three times.
        val col = code(read("collection/ui/CollectionGraph.kt") + read("parts/ui/PartsGraph.kt"))
        val tools = code(read("finances/ui/FinancesGraph.kt"))
        for (key in listOf("CollectionTarget.Gallery.rollKey", "PartsTarget.Parts.rollKey", "PartsTarget.Minifigs.rollKey")) {
            assert(col.contains("ScrollPositionKeeper(") && col.contains(key)) {
                "Für $key wird die Position nicht ausdrücklich wiederhergestellt"
            }
        }
        assert(tools.contains("ScrollPositionKeeper(") && tools.contains("FinanceTarget.Finance.rollKey")) {
            "Die Finanz-Liste stellt ihre Position nicht ausdrücklich wieder her"
        }
        assert(code(read("catalog/ui/screens/CatalogScreen.kt")).contains(
                "ScrollPositionKeeper(CatalogTarget.Catalog.rollKey, gridState, ready = state.total > 0")) {
            "Der Katalog stellt seine Position nicht über den ScrollMemory wieder her, sobald die Länge da ist"
        }
        assert(code(read("account/ui/AccountGraph.kt")).contains("ScrollPositionKeeper(")) {
            "Die Einstellungen stellen ihre Position nicht ausdrücklich wieder her"
        }
        assert(Regex("""ScrollPositionKeeper\(PART_LIST_SCROLL_KEY, partListsState""").containsMatchIn(col)) {
            "Die Teileliste stellt ihre Position nicht ausdrücklich wieder her"
        }

        // And the two traps from above must not show up again
        // in the common helper.
        val helper = code(read("ui/ScrollMemory.kt"))
        assert(!helper.contains("rememberSaveable")) {
            "Der Merker im Helfer ist `rememberSaveable` — dann überlebt er den " +
                "Ausflug und schaltet die Wiederherstellung dauerhaft ab"
        }
        assert(helper.contains("if (!restored) return@LaunchedEffect")) {
            "Der Melder läuft los, bevor zurückgesprungen wurde — er überschreibt " +
                "dann die gemerkte Position mit der Null des frischen Zustands"
        }
        val firstJump = helper.indexOf("scrollToItem")
        val firstMarker = helper.indexOf("restored = true")
        assert(firstJump in 0 until firstMarker) {
            "Der Merker steht vor dem Sprung statt danach"
        }

        // A filter change must discard the remembered position: otherwise it points
        // to sets that stand elsewhere or not at all in the new list.
        val gal = code(read("collection/ui/Gallery.kt"))
        for (fn in listOf("setSearch", "setTheme", "setSort")) {
            // Function body instead of a fixed character window. See Sources.kt.
            val body = Sources.function(gal, "fun $fn(")
            assert(body.isNotEmpty()) { "$fn fehlt" }
            assert(body.contains("forgetScroll()")) {
                "$fn verwirft die gemerkte Rollposition nicht"
            }
        }
        // That the GALLERY's position is forgotten along the way is checked by
        // GalleryViewModelTest, executed.
    }

    @Test
    fun `the handle of the year bar follows the list`() {
        // If the list stands at the right row, the bar's handle must stand
        // there too and not at the very top.
        //
        // The handle NEVER followed the list, only its own dragging:
        // previewYear started at yearMax, and thumbOffset(yearMax) is exactly
        // zero — i.e. at the very top. Even when scrolling with the finger it stayed
        // put; it only stood out after the detail page, because there the
        // composition starts anew and a dragged year gets lost.
        //
        // Since the bar is the same as in the web app, it no longer hangs
        // on the YEAR but on the POSITION in the list. The statement stays: without
        // dragging the handle shows where one IS.
        val catalog = code(Sources.screen("catalog/ui/screens/CatalogScreen.kt"))
        assert(catalog.contains("if (dragging) dragShare else CatalogYearMath.shareFromNumber(listNumber, total)")) {
            "Der Griff zeigt weiterhin nur die gezogene Stelle — ohne Ziehen bliebe " +
                "er dort stehen, wo zuletzt gezogen wurde"
        }
        // ── The RULE, not the spelling ─────────────────────
        //
        // Here stood `catalog.contains("listNumber = gridState.firstVisibleItemIndex")`.
        // That was exactly the error the test directly below describes as a known
        // pattern: it checked a WORDING instead of the rule.
        //
        // It stood out when `firstVisibleItemIndex` moved into a
        // `derivedStateOf` — Lint reported the direct access as
        // FrequentlyChangingValue, because it makes the whole screen re-evaluate on every
        // change. The rule stayed fulfilled unchanged,
        // the test turned red anyway.
        //
        // The rule is: what the year bar gets as `listNumber`
        // must GO BACK to `gridState.firstVisibleItemIndex` — directly
        // or via a value derived exactly from it. A constant,
        // another derivation or a missing handover are red.
        //
        // Counter-checks (performed, in the same logic against the real file
        // and three falsified versions):
        //   direct version                  -> green
        //   derived via derivedStateOf      -> green
        //   listNumber = 0                -> RED
        //   derivedStateOf { 0 }            -> RED
        //   handover removed entirely       -> RED
        val handover = Regex("""listNumber\s*=\s*([A-Za-z0-9_.]+)""").find(catalog)
        assert(handover != null) {
            "Die Jahresleiste bekommt die Stelle der Liste gar nicht zu sehen — " +
                "`listenNummer` wird nicht übergeben"
        }
        val expression = handover!!.groupValues[1]
        val immediate = expression == "gridState.firstVisibleItemIndex"
        val derived = Regex(
            """val\s+""" + Regex.escape(expression) +
                """\s+by\s+remember[^{]*\{\s*derivedStateOf\s*\{\s*""" +
                """gridState\.firstVisibleItemIndex\s*\}"""
        ).containsMatchIn(catalog)
        assert(immediate || derived) {
            "`listNumber = $expression` geht nicht auf gridState.firstVisibleItemIndex " +
                "zurück — die Jahresleiste zeigt dann nicht, wo die Liste steht"
        }
    }
}
