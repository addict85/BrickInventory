package ch.brickinventoryapp.collection

import androidx.lifecycle.SavedStateHandle
import ch.brickinventoryapp.collection.ui.viewmodel.GalleryViewModel
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.TestServices
import ch.brickinventoryapp.testing.testFinancesRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Whoever loads the gallery over selected accounts carries along what the gallery shows:
 * the account view asks the server with the view, search, theme and sorting,
 * and does so for every page — otherwise a filtered first page would have
 * an unfiltered second page hanging off it.
 *
 * Counter-check: in GalleryViewModel.accountQuery the search set to null → red
 * “every page of the account view carries the view and the filters”.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GalleryLoadsFilteredTest {

    @Test
    fun `every page of the account view carries view and filter`() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        val paths = PathServer("/api/v1/sets" to """{"success":true,"total":2,"sets":[
            {"set_number":"75192-1","name":"Falke"},{"set_number":"10294-1","name":"Titanic"}]}""",
            "/api/v1/stats" to """{"success":true,"stats":{"total_sets":5,"total_quantity":5,"total_pieces":0,"total_instructions":0,"total_parts":0,"total_minifigs":0}}""")
        val t = TestServices(paths.onTick(), io = Dispatchers.Main)
        try {
            val wanted = SavedStateHandle(mapOf("galerie_suche" to "Falke",
                "galerie_thema" to "Star Wars", "galerie_sortierung" to "year_desc"))
            val vm = t.track(GalleryViewModel(t.session, t.filter(), t.hints, t.changes, t.scrollMemory, t.sets(),
                t.accountView, testFinancesRepository(t.api), wanted))
            vm.setScope(ScopeFilter.View.GALLERY, "own")
            assertEquals(listOf("75192-1", "10294-1"), vm.galleryState.value.sets.map { it.setNumber })
            val fetches = paths.requestsTo("GET /api/v1/sets?")
            assertTrue("kein Abruf", fetches.isNotEmpty())
            for (a in fetches) for (part in listOf("accounts=own", "search=Falke", "theme=Star%20Wars", "sort=year_desc")) {
                assertTrue("$a ohne $part", part in a)
            }
        } finally {
            t.cleanUp()
            Dispatchers.resetMain()
            paths.server.shutdown()
        }
    }
}
