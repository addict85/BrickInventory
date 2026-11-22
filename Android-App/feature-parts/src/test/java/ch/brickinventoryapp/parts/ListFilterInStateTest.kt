package ch.brickinventoryapp.parts

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.parts.ui.PartsFilter
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.state.testing.TestServices
import ch.brickinventoryapp.testing.Sources
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A list filter belongs in the list's state, not in the call.
 *
 * ── The finding ──────────────────────────────────────────────────────────────
 * The gallery holds search text, theme and sorting in GalleryUiState; EVERY
 * loader reads them there. The parts list held its search text in a local
 * variable of the screen (`var searchQuery by rememberSaveable`) and passed
 * it along as an argument — `loadParts(search = …)`.
 *
 * That meant only whoever loaded from the search field knew the filter. Every other
 * path loaded unfiltered:
 *
 *   - `onLoadMore(page)` fetched page 2 of the WHOLE stock and appended it to
 *     a filtered page 1; `partsTotal` came from the same unfiltered
 *     query, so infinite scroll was computing against a foreign number.
 *   - `onRefresh` explicitly passed `search = null` — the list jumped to the
 *     whole stock while the search field next to it kept showing the text.
 *
 * The same shape as the gallery's second loader (GalleryLoadsFilteredTest):
 * one path carries the filter along, a second does not. As long as the filter is a
 * parameter, this second path can keep reappearing — as a field in the
 * state, it cannot.
 *
 * ── Why only these three names ──────────────────────────────────────────────
 * `search`, `theme`, `sort` are the filters that restrict a LIST and
 * next to which a total count stands. That is exactly where the damage comes from:
 * paged pages and a total count from different queries.
 *
 * ALL loaders under ui/ are checked, not just MainViewModel's:
 * CatalogViewModel pages the same way (ensureCatalogPage) and also holds its
 * filters in the state. If the rule were limited to MainViewModel, of all
 * screens the second paging one would be allowed to break it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ListFilterInStateTest {

    @Test
    fun `no loader takes a list filter as a parameter`() {
        val filter = listOf("search", "theme", "sort")
        val violations = mutableListOf<String>()
        var loader = 0

        for (file in Sources.below("ui")) {
            val src = Sources.withoutComments(file.readText())
            for (hits in Regex("""fun (load\w+)\(([^)]*)\)""").findAll(src)) {
                loader++
                val name = hits.groupValues[1]
                val parameter = hits.groupValues[2]
                // Only the PARAMETER NAME counts, not a default value: otherwise
                // `sort: String = "sort_name"` would report itself.
                val names = parameter.split(",").mapNotNull {
                    it.substringBefore(':').trim().takeIf { n -> n.isNotEmpty() }
                }
                val guilty = names.filter { it in filter }
                if (guilty.isNotEmpty()) {
                    violations += "${file.name}: $name nimmt ${guilty.joinToString()} als Parameter"
                }
            }
        }

        // Self-proof: if the pattern finds no loaders, the list would be empty and
        // the test green, without having checked anything.
        assert(loader >= 20) {
            "Only $loader loaders found — the pattern 'fun loadXyz(' no longer matches."
        }

        assert(violations.isEmpty()) {
            "These loaders take a list filter as an argument:\n  " +
                violations.joinToString("\n  ") +
                "\nThen only whoever passes it knows it — every other loading path loads " +
                "unfiltered and appends the result to a filtered list. " +
                "The filter belongs in the list's UiState; the loader reads it there."
        }
    }

    /**
     * Run: the first page, loading more, and the manual parts section
     * carry the view and the search text (PartsViewModel against a PathServer without network).
     * Counter-check: in PartsViewModel.manualParts
     * `teileSicht` → `null` → red “… without accounts=own”.
     */
    @Test
    fun `first page, loading more and manual parts carry view and search text`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val paths = PathServer(
            "/api/v1/parts" to """{"success":true,"total":900,"parts":[{"part_number":"3001"}]}""",
            "/api/v1/parts/manual" to """{"success":true,"parts":[{"part_number":"3002"}]}""")
        val t = TestServices(paths.onTick(), io = Dispatchers.Main)
        try {
            val vm = t.track(PartsViewModel(t.session, t.filter(), t.hints, t.changes, t.scrollMemory, testPartsRepository(t.api), t.accountView,
                SavedStateHandle(mapOf("teile_filter" to PartsFilter(search = "Stein")))))
            vm.setScope(ScopeFilter.View.PARTS, "own")
            // Page 1 fetches the manual parts along; only load more after that, otherwise
            // loading more cancels this fetch.
            assertTrue("manual parts", vm.partsState.value.manualParts != null)
            vm.loadParts(page = 2)
            assertTrue("second page", paths.requestsTo("page=2").isNotEmpty())
            val fetches = paths.requestsTo("GET /api/v1/parts?") + paths.requestsTo("GET /api/v1/parts/manual")
            assertTrue("Not two pages: $fetches", fetches.count { it.startsWith("GET /api/v1/parts?") } >= 2)
            for (a in fetches) for (part in listOf("accounts=own", "search=Stein")) assertTrue("$a without $part", part in a)
        } finally {
            t.cleanUp()
            Dispatchers.resetMain()
            paths.server.shutdown()
        }
    }

    /**
     * As structure: the filtered parts list fetches only the account view
     * (core-data, AccountView's parts list); its call names both.
     */
    @Test
    fun `every fetch of the parts list carries view and search text`() {
        val calls = listOf("parts.getParts(")
        // The parts API does not know theme and sort (`utils/handlers/parts.ts`,
        // getParts reads color, category, search, spare, set_number, page).
        val required = listOf("accounts", "search")
        val missing = mutableListOf<String>()
        var found = 0

        for (file in Sources.all()) for (call in calls) {
            val src = Sources.withoutComments(file.readText())
            var i = src.indexOf(call)
            while (i >= 0) {
                found++
                var depth = 1
                var j = i + call.length
                while (j < src.length && depth > 0) {
                    val c = src[j]
                    if (c == '(') {
                        depth++
                    } else if (c == ')') {
                        depth--
                    }
                    j++
                }
                val text = src.substring(i, j)
                val absent = required.filterNot { text.contains(it) }
                if (absent.isNotEmpty()) {
                    val row = src.substring(0, i).count { it == '\n' } + 1
                    missing += "${file.name}:$row — es fehlt: ${absent.joinToString()}"
                }
                i = src.indexOf(call, j)
            }
        }

        assert(found >= 1) { "No call of $calls found — pattern outdated?" }
        assert(missing.isEmpty()) {
            "These fetches of the parts list leave something out:\n  " + missing.joinToString("\n  ")
        }
    }

    /**
     * The search happens on the server, not in the screen.
     *
     * ── The finding ──────────────────────────────────────────────────────────
     * MinifigsScreen held its search text locally and filtered the already
     * loaded list itself:
     *
     *     figs.filter { it.figNumber.contains(search, ignoreCase = true) ||
     *                   it.figName?.contains(search, ignoreCase = true) == true }
     *
     * That meant the same search rule stood twice in the tree — once here, once in
     * `utils/handlers/minifigs.ts`. And they were not identical: the
     * server searches BEFORE grouping, across every fig_name row, the
     * screen afterward only across the one that MAX(fig_name) leaves behind.
     *
     * ── What is checked ───────────────────────────────────────────────────
     * A `.filter { … contains(…, ignoreCase = true) … }` under ui/ is the
     * shape of a search in the screen. It stays allowed where the list lies
     * COMPLETELY in memory and does not page — there, a trip to the server would
     * just be slower. Those spots stand below with a reason.
     */
    @Test
    fun `no search in the screen over a loaded list`() {
        // Fully loaded, short lists without paging and without
        // a total count next to them — here, local filtering is correct.
        val allowed = mapOf(
            "CatalogSections.kt" to
                "Themenliste des Katalogs: einmal komplett geladen (state.themes), " +
                "keine Seiten, keine Gesamtzahl. Ein Serverbesuch je Tastendruck " +
                "waere nur langsamer."
        )

        val pattern = Regex("""\.filter\s*\{[^}]*contains\([^)]*ignoreCase\s*=\s*true""")
        val found = mutableListOf<Pair<String, Int>>()

        for (file in Sources.below("ui")) {
            val src = Sources.withoutComments(file.readText())
            for (hits in pattern.findAll(src)) {
                val row = src.substring(0, hits.range.first).count { it == '\n' } + 1
                found += file.name to row
            }
        }

        // Self-proof: if the pattern finds nothing at all, the list would be empty and
        // the test green, without having checked anything. At least the one
        // justified spot is expected.
        assert(found.isNotEmpty()) {
            "Not a single local filtering found — the pattern no longer matches."
        }

        val violations = found.filterNot { it.first in allowed }
        assert(violations.isEmpty()) {
            "Here the screen searches over a loaded list:\n  " +
                violations.joinToString("\n  ") { "${it.first}:${it.second}" } +
                "\nThen the search rule exists twice — here and in the server handler — " +
                "and sooner or later both hit something different. The search text " +
                "belongs in the UiState, the loader passes it to the server. If the " +
                "list is loaded completely and does not page, it belongs with a " +
                "reason in the list `allowed` above."
        }

        // A line nobody needs anymore is a permission nobody
        // checks — the same rule as in the web app's guards.
        val stale = allowed.keys.filterNot { name -> found.any { it.first == name } }
        assert(stale.isEmpty()) {
            "These entries no longer describe local filtering — strike them:\n  " +
                stale.joinToString("\n  ")
        }
    }
}
