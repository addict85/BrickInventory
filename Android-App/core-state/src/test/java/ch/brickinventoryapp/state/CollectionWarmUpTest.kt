package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testAccountView
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testMinifigsRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.state.testing.StorageStore
import ch.brickinventoryapp.state.ui.ScopeService
import ch.brickinventoryapp.state.ui.imageAddressesTheCollection
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Which images are warmed up, against a test server: the tiles of all tabs of the
 * own collection (sets, parts, figures, manually captured parts and figures), each
 * from the tab's own source — with an account filter, the account view — and nothing from the
 * catalog, whose roughly 25,000 sets would blow past the limit many times over.
 *
 * Counter-checks (patches under counter-checks/):
 *   vorwaermen-ohne-blickfeld  the parts fetched without the account filter → red „vorgewärmt wird …“
 *   vorwaermen-ohne-figuren    the figures no longer collected → red „vorgewärmt wird …“
 */
class CollectionWarmUpTest {

    private val responses = arrayOf(
        "/api/v1/sets" to """{"success":true,"total":1,"sets":[{"set_number":"75192-1","name":"Falke","image_local":"/b/set_thumb.jpg"}]}""",
        "/api/v1/parts" to """{"success":true,"total":1,"parts":[{"part_number":"3001","color_id":5,"part_name":"Brick","color_name":"Red","image_local":"/b/teil_thumb.jpg","total_quantity":2}]}""",
        "/api/v1/minifigs" to """{"success":true,"figs":[{"fig_number":"sw0001","fig_name":"Luke","image_local":"/b/figur_thumb.jpg","quantity":1}]}""",
        "/api/v1/parts/manual" to """{"success":true,"parts":[{"id":9,"part_number":"3002","part_name":"Brick 2x3","color_id":5,"color_name":"Red","quantity":1,"image_local":"/b/mteil_thumb.jpg"}]}""",
        "/api/v1/minifigs/manual" to """{"success":true,"figs":[{"id":3,"fig_number":"sw0002","fig_name":"Han","quantity":1,"image_local":"/b/mfigur_thumb.jpg"}]}""",
    )

    @Test
    fun `every tab of the collection in view is warmed, not the catalog`() {
        val paths = PathServer(*responses)
        val folder = File(System.getProperty("java.io.tmpdir"), "bim-sammlung-${System.nanoTime()}").apply { mkdirs() }
        try {
            val api = TestApi.forTarget(paths.server)
            val parts = testPartsRepository(api)
            val viewport = ScopeService(StorageStore(), testHouseholdRepository(api), parts)
            val addresses = runBlocking {
                for (v in listOf(ScopeFilter.View.GALLERY, ScopeFilter.View.PARTS, ScopeFilter.View.MINIFIGS)) viewport.setAccount(v, "own")
                imageAddressesTheCollection(testSetsRepository(api), parts, testMinifigsRepository(api), testAccountView(api), viewport,
                    "https://brick.example")
            }
            assertEquals(listOf("set", "teil", "figur", "mteil", "mfigur").map { "https://brick.example/b/${it}_thumb.jpg" },
                addresses)
            val asked = paths.requests.toList()
            assertEquals(setOf("/api/v1/sets", "/api/v1/parts", "/api/v1/minifigs", "/api/v1/parts/manual", "/api/v1/minifigs/manual"),
                asked.map { it.substringAfter(' ').substringBefore('?') }.toSet())
            assertTrue("Ohne Kontofilter: $asked", asked.all { "accounts=own" in it })
            assertTrue("Nur lesend: $asked", asked.all { it.startsWith("GET ") })
        } finally {
            paths.server.shutdown()
            folder.deleteRecursively()
        }
    }
}
