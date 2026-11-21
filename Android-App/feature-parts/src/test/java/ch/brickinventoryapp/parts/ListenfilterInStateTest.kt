package ch.brickinventoryapp.parts

import ch.brickinventoryapp.parts.ui.Teilefilter
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.junit.Assert.assertTrue
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.Dispatchers
import ch.brickinventoryapp.parts.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.model.data.ScopeFilter
import androidx.lifecycle.SavedStateHandle
import org.junit.Test
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestDienste

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
class ListenfilterInStateTest {

    @Test
    fun `no loader takes a list filter as a parameter`() {
        val filter = listOf("search", "theme", "sort")
        val violations = mutableListOf<String>()
        var lader = 0

        for (datei in Quellen.unter("ui")) {
            val src = Quellen.withoutComments(datei.readText())
            for (treffer in Regex("""fun (load\w+)\(([^)]*)\)""").findAll(src)) {
                lader++
                val name = treffer.groupValues[1]
                val parameter = treffer.groupValues[2]
                // Only the PARAMETER NAME counts, not a default value: otherwise
                // `sort: String = "sort_name"` would report itself.
                val namen = parameter.split(",").mapNotNull {
                    it.substringBefore(':').trim().takeIf { n -> n.isNotEmpty() }
                }
                val guilty = namen.filter { it in filter }
                if (guilty.isNotEmpty()) {
                    violations += "${datei.name}: $name nimmt ${guilty.joinToString()} als Parameter"
                }
            }
        }

        // Self-proof: if the pattern finds no loaders, the list would be empty and
        // the test green, without having checked anything.
        assert(lader >= 20) {
            "Nur $lader Lader gefunden — das Muster 'fun loadXyz(' passt nicht mehr."
        }

        assert(violations.isEmpty()) {
            "Diese Lader nehmen einen Listenfilter als Argument:\n  " +
                violations.joinToString("\n  ") +
                "\nDann kennt ihn nur, wer ihn mitgibt — jeder andere Ladeweg laedt " +
                "ungefiltert und haengt das Ergebnis an eine gefilterte Liste. " +
                "Der Filter gehoert in den UiState der Liste; der Lader liest ihn dort."
        }
    }

    /**
     * Run: the first page, loading more, and the manual parts section
     * carry the view and the search text (PartsViewModel against a PfadServer without network).
     * Counter-check: in PartsViewModel.manuelleTeile
     * `teileSicht` → `null` → red “… ohne accounts=own”.
     */
    @Test
    fun `first page, loading more and manual parts carry view and search text`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val paths = PfadServer(
            "/api/v1/parts" to """{"success":true,"total":900,"parts":[{"part_number":"3001"}]}""",
            "/api/v1/parts/manual" to """{"success":true,"parts":[{"part_number":"3002"}]}""")
        val t = TestDienste(paths.imTakt(), io = Dispatchers.Main)
        try {
            val vm = t.merke(PartsViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.scrollMemory, testPartsRepository(t.api), t.kontosicht,
                SavedStateHandle(mapOf("teile_filter" to Teilefilter(suche = "Stein")))))
            vm.setScope(ScopeFilter.View.PARTS, "own")
            // Page 1 fetches the manual parts along; only load more after that, otherwise
            // loading more cancels this fetch.
            assertTrue("manuelle Teile", vm.teileState.value.manualParts != null)
            vm.loadParts(page = 2)
            assertTrue("zweite Seite", paths.requestsAn("page=2").isNotEmpty())
            val fetches = paths.requestsAn("GET /api/v1/parts?") + paths.requestsAn("GET /api/v1/parts/manual")
            assertTrue("Keine zwei Seiten: $fetches", fetches.count { it.startsWith("GET /api/v1/parts?") } >= 2)
            for (a in fetches) for (teil in listOf("accounts=own", "search=Stein")) assertTrue("$a ohne $teil", teil in a)
        } finally {
            t.aufraeumen()
            Dispatchers.resetMain()
            paths.server.shutdown()
        }
    }

    /**
     * As structure: the filtered parts list fetches only the account view
     * (core-data, Kontosicht.teileliste); its call names both.
     */
    @Test
    fun `every fetch of the parts list carries view and search text`() {
        val calls = listOf("teile.getParts(")
        // The parts API does not know theme and sort (utils/handlers/parts.ts,
        // getParts reads color, category, search, spare, set_number, page).
        val pflicht = listOf("accounts", "search")
        val missing = mutableListOf<String>()
        var gefunden = 0

        for (datei in Quellen.alle()) for (call in calls) {
            val src = Quellen.withoutComments(datei.readText())
            var i = src.indexOf(call)
            while (i >= 0) {
                gefunden++
                var tiefe = 1
                var j = i + call.length
                while (j < src.length && tiefe > 0) {
                    val c = src[j]
                    if (c == '(') {
                        tiefe++
                    } else if (c == ')') {
                        tiefe--
                    }
                    j++
                }
                val text = src.substring(i, j)
                val fehlt = pflicht.filterNot { text.contains(it) }
                if (fehlt.isNotEmpty()) {
                    val zeile = src.substring(0, i).count { it == '\n' } + 1
                    missing += "${datei.name}:$zeile — es fehlt: ${fehlt.joinToString()}"
                }
                i = src.indexOf(call, j)
            }
        }

        assert(gefunden >= 1) { "Kein Aufruf von $calls gefunden — Muster veraltet?" }
        assert(missing.isEmpty()) {
            "Diese Abrufe der Teileliste lassen etwas weg:\n  " + missing.joinToString("\n  ")
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
     * utils/handlers/minifigs.ts. And they were not identical: the
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
        val erlaubt = mapOf(
            "CatalogSections.kt" to
                "Themenliste des Katalogs: einmal komplett geladen (state.themes), " +
                "keine Seiten, keine Gesamtzahl. Ein Serverbesuch je Tastendruck " +
                "waere nur langsamer."
        )

        val pattern = Regex("""\.filter\s*\{[^}]*contains\([^)]*ignoreCase\s*=\s*true""")
        val gefunden = mutableListOf<Pair<String, Int>>()

        for (datei in Quellen.unter("ui")) {
            val src = Quellen.withoutComments(datei.readText())
            for (treffer in pattern.findAll(src)) {
                val zeile = src.substring(0, treffer.range.first).count { it == '\n' } + 1
                gefunden += datei.name to zeile
            }
        }

        // Self-proof: if the pattern finds nothing at all, the list would be empty and
        // the test green, without having checked anything. At least the one
        // justified spot is expected.
        assert(gefunden.isNotEmpty()) {
            "Kein einziges oertliches Filtern gefunden — das Muster passt nicht mehr."
        }

        val violations = gefunden.filterNot { it.first in erlaubt }
        assert(violations.isEmpty()) {
            "Hier wird im Bildschirm ueber eine geladene Liste gesucht:\n  " +
                violations.joinToString("\n  ") { "${it.first}:${it.second}" } +
                "\nDann steht die Suchregel zweimal — hier und im Server-Handler — " +
                "und beide treffen frueher oder spaeter etwas anderes. Der Suchtext " +
                "gehoert in den UiState, der Lader gibt ihn dem Server mit. Ist die " +
                "Liste vollstaendig geladen und blaettert nicht, gehoert sie mit " +
                "Grund in die Liste `erlaubt` oben."
        }

        // A line nobody needs anymore is a permission nobody
        // checks — the same rule as in the web app's guards.
        val veraltet = erlaubt.keys.filterNot { name -> gefunden.any { it.first == name } }
        assert(veraltet.isEmpty()) {
            "Diese Eintraege beschreiben kein oertliches Filtern mehr — streichen:\n  " +
                veraltet.joinToString("\n  ")
        }
    }
}
