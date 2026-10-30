package ch.brickinventoryapp

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.ui.viewmodel.GalerieViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wer die Galerie laedt, fuehrt mit, was die Galerie anzeigt.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * Es gab ZWEI Lader fuer dieselbe Liste. `loadSets()` und `loadMoreSets()`
 * reichten Haushaltsfilter, Suchtext, Themenfilter und Sortierung durch;
 * `loadGallery()` rief `repo.sets.getSets()` ohne jedes Argument.
 *
 * Wer mit gesetztem Filter ein Set per Barcode erfasste, bekam danach eine
 * ungefilterte Seite 1 in einer Ansicht, deren Filterchips weiter den alten
 * Stand zeigten.
 *
 * Schlimmer noch die Paginierung: `loadMoreSets()` prueft
 * `sets.size >= galleryTotal`. Nach einem `loadGallery()` standen dort eine
 * UNGEFILTERTE Liste und eine GEFILTERTE Gesamtzahl nebeneinander — je nachdem
 * entweder gar kein Nachladen mehr, oder gefilterte Seiten, an eine
 * ungefilterte Liste gehaengt.
 *
 * Aufgefallen ist es beim Vergleich, welche Ladewege `scopeFor()` mitgeben:
 * neun ja, einer nein. Nicht beim Lesen — der zweite Lader sah fuer sich
 * genommen voellig richtig aus.
 *
 * ── Was geprueft wird ───────────────────────────────────────────────────────
 * Ausgeführt: Erste Seite und Nachladen der Galerie tragen Blickfeld, Lager
 * und die drei Filter (GalerieViewModel gegen einen Testserver). Dazu als
 * Struktur: Jeder Aufruf von `sets.getSets(` nennt das Blickfeld und die drei
 * Filter — GEFUNDEN, nicht aufgezählt, damit ein dritter Lader (das
 * Vorwärmen, ui/Vorwaermen.kt, ist im JVM-Bau nicht übersetzbar) mitgeprüft ist.
 *
 * Gegenprobe (29.10.2026, gemessen): in GalerieViewModel.holeSeite `search =
 * null` → rot „erste Seite und Nachladen tragen dieselben Filter“.
 */
class GalerieLaedtGefiltertTest {

    @Test
    fun `erste Seite und Nachladen tragen dieselben Filter`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val pfade = PfadServer("/api/v1/sets" to """{"success":true,"total":5,"sets":[
            {"set_number":"75192-1","name":"Falke"},{"set_number":"10294-1","name":"Titanic"}]}""",
            "/api/v1/stats" to """{"success":true,"stats":{"total_sets":5}}""")
        val t = TestDienste(pfade.server)
        try {
            val gemerkt = SavedStateHandle(mapOf("galerie_suche" to "Falke",
                "galerie_thema" to "Star Wars", "galerie_sortierung" to "year_desc"))
            val vm = t.merke(GalerieViewModel(t.dienste, SetsRepository(t.api, t.cache),
                FinanzenRepository(t.api, t.cache), gemerkt))
            vm.setScope(ScopeFilter.View.GALLERY, "own")
            TestApi.warteBis("erste Seite") { vm.galleryState.value.sets.isNotEmpty() }
            vm.loadMoreSets()
            TestApi.warteBis("zweite Seite") { pfade.anfragenAn("page=2").isNotEmpty() }
            val abrufe = pfade.anfragenAn("GET /api/v1/sets?")
            assertTrue("Keine zwei Seiten: $abrufe", abrufe.size >= 2)
            for (a in abrufe) for (teil in listOf("accounts=own", "search=Falke", "theme=Star%20Wars", "sort=year_desc")) {
                assertTrue("$a ohne $teil", teil in a)
            }
            assertEquals(1, abrufe.count { "page=2" in it })
        } finally {
            t.aufraeumen()
            Dispatchers.resetMain()
            pfade.server.shutdown()
        }
    }

    @Test
    fun `jeder Abruf der Set-Liste fuehrt Blickfeld und Filter mit`() {
        val fehlend = mutableListOf<String>()
        var gefunden = 0

        for (datei in Quellen.alle()) {
            val src = Quellen.ohneKommentare(datei.readText())
            var i = src.indexOf(AUFRUF)
            while (i >= 0) {
                gefunden++
                val aufruf = src.substring(i, endeDesAufrufs(src, i))
                val fehlt = PFLICHT.filterNot { aufruf.contains(it) }
                if (fehlt.isNotEmpty()) {
                    val zeile = src.substring(0, i).count { it == '\n' } + 1
                    fehlend += "${datei.name}:$zeile — es fehlt: ${fehlt.joinToString()}"
                }
                i = src.indexOf(AUFRUF, i + AUFRUF.length)
            }
        }

        // Selbstbeweis: Findet das Muster nichts, waere die Liste leer und der
        // Test gruen, ohne etwas geprueft zu haben. Erste Seite und Nachladen
        // gehen durch DENSELBEN Abruf (GalerieViewModel), dazu das Vorwaermen.
        assert(gefunden >= 2) {
            "Nur $gefunden Aufruf(e) von '$AUFRUF' gefunden — Muster veraltet?"
        }

        assert(fehlend.isEmpty()) {
            "Diese Abrufe der Set-Liste lassen etwas weg:\n  " + fehlend.joinToString("\n  ") +
                "\nDie Liste passt danach nicht mehr zu den Filterchips daneben, und " +
                "galleryTotal gehoert zu einer anderen Abfrage als sets."
        }
    }

    private companion object {
        const val AUFRUF = "sets.getSets("

        /** Blickfeld plus die drei Filter, die die Galerie anzeigt. */
        val PFLICHT = listOf("ScopeFilter.View.GALLERY", "search", "theme", "sort")

        /**
         * Das Ende des Aufrufs ist seine schliessende Klammer — die Argumente
         * stehen ueber mehrere Zeilen, ein festes Zeilenfenster waere wieder
         * die Konstruktion, die in dieser Reihe schon viermal gebrochen ist.
         */
        fun endeDesAufrufs(src: String, start: Int): Int {
            var tiefe = 1
            var j = start + AUFRUF.length
            while (j < src.length && tiefe > 0) {
                val c = src[j]
                if (c == '(') {
                    tiefe++
                } else if (c == ')') {
                    tiefe--
                }
                j++
            }
            return j
        }
    }
}
