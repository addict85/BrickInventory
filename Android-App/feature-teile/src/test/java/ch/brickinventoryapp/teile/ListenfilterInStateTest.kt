package ch.brickinventoryapp.teile

import ch.brickinventoryapp.teile.ui.Teilefilter
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.junit.Assert.assertTrue
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.Dispatchers
import ch.brickinventoryapp.teile.ui.viewmodel.PartsViewModel
import ch.brickinventoryapp.model.data.ScopeFilter
import androidx.lifecycle.SavedStateHandle
import org.junit.Test
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.testing.testPartsRepository
import ch.brickinventoryapp.testing.TestDienste

/**
 * Ein Listenfilter gehoert in den Zustand der Liste, nicht in den Aufruf.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Die Galerie haelt Suchtext, Thema und Sortierung in GalleryUiState; JEDER
 * Lader liest sie dort. Die Teileliste hielt ihren Suchtext in einer lokalen
 * Variablen des Bildschirms (`var searchQuery by rememberSaveable`) und gab
 * ihn als Argument mit — `loadParts(search = …)`.
 *
 * Damit kannte den Filter nur, wer aus dem Suchfeld heraus lud. Alle anderen
 * Wege luden ungefiltert:
 *
 *   - `onLoadMore(page)` holte Seite 2 des GANZEN Bestands und haengte sie an
 *     eine gefilterte Seite 1; `partsTotal` kam aus derselben ungefilterten
 *     Abfrage, der Endlos-Scroll rechnete also gegen eine fremde Zahl.
 *   - `onRefresh` gab ausdruecklich `search = null` — die Liste sprang auf den
 *     ganzen Bestand, waehrend das Suchfeld daneben den Text weiter zeigte.
 *
 * Dieselbe Form wie beim zweiten Galerie-Lader (GalleryLoadsFilteredTest):
 * Ein Weg fuehrt den Filter mit, ein zweiter nicht. Solange der Filter ein
 * Parameter ist, kann es diesen zweiten Weg immer wieder geben — als Feld im
 * Zustand kann es ihn nicht mehr geben.
 *
 * ── Warum nur diese drei Namen ──────────────────────────────────────────────
 * `search`, `theme`, `sort` sind die Filter, die eine LISTE einschraenken und
 * neben denen eine Gesamtzahl steht. Genau daraus entsteht der Schaden:
 * geblaetterte Seiten und eine Gesamtzahl aus verschiedenen Abfragen.
 *
 * Geprueft werden ALLE Lader unter ui/, nicht nur die des MainViewModel:
 * CatalogViewModel blaettert genauso (ensureCatalogPage) und haelt seine
 * Filter ebenfalls im Zustand. Waere die Regel auf MainViewModel begrenzt,
 * duerfte ausgerechnet der zweite blaetternde Bildschirm sie brechen.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ListenfilterInStateTest {

    @Test
    fun `kein Lader nimmt einen Listenfilter als Parameter`() {
        val filter = listOf("search", "theme", "sort")
        val violations = mutableListOf<String>()
        var lader = 0

        for (datei in Quellen.unter("ui")) {
            val src = Quellen.withoutComments(datei.readText())
            for (treffer in Regex("""fun (load\w+)\(([^)]*)\)""").findAll(src)) {
                lader++
                val name = treffer.groupValues[1]
                val parameter = treffer.groupValues[2]
                // Nur der PARAMETERNAME zaehlt, nicht ein Vorgabewert: Sonst
                // meldete `sort: String = "sort_name"` sich selbst.
                val namen = parameter.split(",").mapNotNull {
                    it.substringBefore(':').trim().takeIf { n -> n.isNotEmpty() }
                }
                val guilty = namen.filter { it in filter }
                if (guilty.isNotEmpty()) {
                    violations += "${datei.name}: $name nimmt ${guilty.joinToString()} als Parameter"
                }
            }
        }

        // Selbstbeweis: Findet das Muster keine Lader, waere die Liste leer und
        // der Test gruen, ohne etwas geprueft zu haben.
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
     * Ausgeführt: Erste Seite, Nachladen und der Abschnitt der manuellen Teile
     * tragen Blickfeld und Suchtext (PartsViewModel gegen einen PfadServer ohne Netz).
     * Gegenprobe: in PartsViewModel.manuelleTeile
     * `teileSicht` → `null` → rot „… ohne accounts=own“.
     */
    @Test
    fun `erste Seite, Nachladen und manuelle Teile tragen Blickfeld und Suchtext`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val paths = PfadServer(
            "/api/v1/parts" to """{"success":true,"total":900,"parts":[{"part_number":"3001"}]}""",
            "/api/v1/parts/manual" to """{"success":true,"parts":[{"part_number":"3002"}]}""")
        val t = TestDienste(paths.imTakt(), io = Dispatchers.Main)
        try {
            val vm = t.merke(PartsViewModel(t.sitzung, t.filter(), t.hinweise, t.changes, t.scrollMemory, testPartsRepository(t.api), t.kontosicht,
                SavedStateHandle(mapOf("teile_filter" to Teilefilter(suche = "Stein")))))
            vm.setScope(ScopeFilter.View.PARTS, "own")
            // Seite 1 zieht die manuellen Teile nach; erst danach blättern, sonst
            // bricht das Nachladen diesen Abruf ab.
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
     * Als Struktur: Die gefilterte Teileliste holt allein die Kontosicht
     * (core-data, Kontosicht.teileliste); ihr Aufruf nennt beides.
     */
    @Test
    fun `jeder Abruf der Teileliste fuehrt Blickfeld und Suchtext mit`() {
        val calls = listOf("teile.getParts(")
        // theme und sort kennt die Teile-API nicht (utils/handlers/parts.ts,
        // getParts liest color, category, search, spare, set_number, page).
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
     * Gesucht wird auf dem Server, nicht im Bildschirm.
     *
     * ── Der Befund ──────────────────────────────────────────────────────────
     * MinifigsScreen hielt seinen Suchtext lokal und filterte die schon
     * geladene Liste selbst:
     *
     *     figs.filter { it.figNumber.contains(search, ignoreCase = true) ||
     *                   it.figName?.contains(search, ignoreCase = true) == true }
     *
     * Damit stand dieselbe Suchregel zweimal im Baum — einmal hier, einmal in
     * utils/handlers/minifigs.ts. Und sie waren nicht deckungsgleich: Der
     * Server sucht VOR der Gruppierung ueber jede fig_name-Zeile, der
     * Bildschirm danach nur ueber die eine, die MAX(fig_name) uebrig laesst.
     *
     * ── Was geprueft wird ───────────────────────────────────────────────────
     * Ein `.filter { … contains(…, ignoreCase = true) … }` unter ui/ ist die
     * Form einer Suche im Bildschirm. Erlaubt bleibt sie, wo die Liste
     * VOLLSTAENDIG im Speicher liegt und nicht blaettert — dort waere ein
     * Serverbesuch nur langsamer. Diese Stellen stehen unten mit Grund.
     */
    @Test
    fun `keine Suche im Bildschirm ueber eine geladene Liste`() {
        // Vollstaendig geladene, kurze Listen ohne Blaettern und ohne
        // Gesamtzahl daneben — hier ist oertliches Filtern richtig.
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

        // Selbstbeweis: Findet das Muster gar nichts, waere die Liste leer und
        // der Test gruen, ohne etwas geprueft zu haben. Erwartet wird
        // mindestens die eine begruendete Stelle.
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

        // Eine Zeile, die niemand mehr braucht, ist eine Erlaubnis, die niemand
        // prueft — dieselbe Regel wie in den Waechtern der Webapp.
        val veraltet = erlaubt.keys.filterNot { name -> gefunden.any { it.first == name } }
        assert(veraltet.isEmpty()) {
            "Diese Eintraege beschreiben kein oertliches Filtern mehr — streichen:\n  " +
                veraltet.joinToString("\n  ")
        }
    }
}
