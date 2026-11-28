package ch.brickinventoryapp.data

import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.contract.ManualPartsResponse
import ch.brickinventoryapp.contract.PartsResponse
import ch.brickinventoryapp.contract.SetsResponse
import ch.brickinventoryapp.contract.testing.testManualPartsResponse
import ch.brickinventoryapp.contract.testing.testPart
import ch.brickinventoryapp.contract.testing.testPartValuationItem
import ch.brickinventoryapp.contract.testing.testPartsResponse
import ch.brickinventoryapp.contract.testing.testSetItem
import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.api.PartsApi
import ch.brickinventoryapp.data.api.SetsApi
import ch.brickinventoryapp.data.collection.SetsRepositoryImpl
import ch.brickinventoryapp.data.parts.PartsRepositoryImpl
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.data.SparePartChoice
import ch.brickinventoryapp.model.domain.CategoryChoice
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.domain.SetSort
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.testing.InMemoryRoom
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import retrofit2.Response
import java.lang.reflect.Proxy
import java.net.ConnectException

/**
 * Room answers search and filter, online as well as without the network — with the same
 * queries as on the device, against an API fake that delivers pages online and
 * fails with ConnectException offline. Runs only in CI.
 *
 * Counter-checks (counter-checks/, the CI job `counter-checks` requires red):
 *   offline-search-as-pattern `%` and `_` not escaped → red „ein Prozentzeichen …“
 *   offline-filter-column    the theme column gets the storage location → red „Suche, Thema …“
 *   gallery-store-unfiltered observeSets passes no filter columns → red „die Galerie filtert in Room …“
 *   parts-page-one-only       refreshPaged stops after page 1 → red „alle Seiten der Teile …“
 *   parts-color-choice-lost    observeParts doesn't pass the color choice on → red „Farbe, Kategorie, Ersatzteile …“
 */
@RunWith(RobolectricTestRunner::class)
class WithoutNetworkFilterTest {

    private val room = InMemoryRoom(ApplicationProvider.getApplicationContext())
    private val stock = room.stock
    private val store = OfflineStore(stock, room.outbox, { "a" }, clock = { STATUS })

    private var offline = false

    @After
    fun tearDown() = room.close()

    private val sets = listOf(
        testSetItem(setNumber = "10001-1", name = "Burg am See", theme = "Castle", storage = "Kiste 1", year = 2001),
        testSetItem(setNumber = "10002-1", name = "Polizeiwache", theme = "City", storage = "Kiste 2", year = 2010),
        testSetItem(setNumber = "10003-1", name = "Seeräuber", theme = "Pirates", storage = "Kiste 1", year = 1999),
        testSetItem(setNumber = "21000-1", name = "Bahnhof", theme = "City", year = null),
        testSetItem(setNumber = "30000-1", name = "Rabatt 50_%", theme = "Promo", year = 2020),
    )

    private val setsApi = object : SetsApi by fake<SetsApi>() {
        override suspend fun getSets(accounts: String?, search: String?, theme: String?, sort: String?, page: Int?,
                                     pageSize: Int?, storage: String?): Response<SetsResponse> {
            if (offline) throw ConnectException("aus")
            val n = pageSize ?: sets.size
            val page = sets.drop(((page ?: 1) - 1) * n).take(n)
            return Response.success(SetsResponse(success = true, count = page.size, sets = page, total = sets.size))
        }
    }
    private val setsRepo = SetsRepositoryImpl(setsApi, store, RetryPolicy.ONCE)

    private val parts = listOf(
        testPart(partNumber = "3001", partName = "Brick 2 x 4", colorId = 4, colorName = "Red", categoryName = "11"),
        testPart(partNumber = "3001", partName = "Brick 2 x 4", colorId = 1, colorName = "Blue", categoryName = "11"),
        testPart(partNumber = "3023", partName = "Plate 1 x 2", colorId = 4, colorName = "Red", categoryName = "14", isSpare = true),
        testPart(partNumber = "3069b", blPartNumber = "87079", partName = "Tile 1 x 2", colorId = 1, colorName = "Blue",
            categoryName = "19"),
    )

    private val partsApi = object : PartsApi by fake<PartsApi>() {
        override suspend fun getParts(search: String?, color: String?, category: String?, page: Int, pageSize: Int,
                                      setNumber: String?, excludeManual: String?, accounts: String?, spare: String?,
                                      withSets: String?, storage: String?): Response<PartsResponse> {
            if (offline) throw ConnectException("aus")
            // Two per page: that way the local list is only complete after page 2.
            val page = parts.drop((page - 1) * 2).take(2)
            return Response.success(testPartsResponse(success = true, total = parts.size, parts = page))
        }
        override suspend fun getManualParts(accounts: String?, search: String?, storage: String?): Response<ManualPartsResponse> {
            if (offline) throw ConnectException("aus")
            return Response.success(testManualPartsResponse(success = true, parts = listOf(testPartValuationItem(partNumber = "m1"))))
        }
    }
    private val partsRepo = PartsRepositoryImpl(partsApi, store, RetryPolicy.ONCE)

    private fun setsOffline(search: String? = null, theme: String? = null, storage: String? = null, sort: SetSort? = null) =
        runBlocking { setsRepo.observeSets(search, theme, storage, sort).first() }
            .also { assertEquals("carries the state", STATUS, it.state) }
            .list.map { it.setNumber }

    private fun partsOffline(search: String? = null, color: String? = null, category: String? = null,
                             spare: SparePartChoice = SparePartChoice.ALL) =
        runBlocking { partsRepo.observeParts(search, ColorPicker.from(color), CategoryChoice.from(category), spare).first() }
            .list.map { "${it.partNumber}/${it.colorName}" }

    private fun loadSetsOnline() = runBlocking { assertTrue(setsRepo.refreshSets() is Outcome.Success) }

    @Test
    fun `search, theme, storage location and sorting of the gallery work offline on the whole local list`() {
        loadSetsOnline()
        offline = true
        assertEquals("Search ignores case, across page 2", listOf("10001-1", "10003-1"), setsOffline(search = "SEE"))
        assertEquals("Search in the year", listOf("10002-1"), setsOffline(search = "2010"))
        assertEquals("Theme", listOf("10002-1", "21000-1"), setsOffline(theme = "City"))
        assertEquals("Storage location", listOf("10001-1", "10003-1"), setsOffline(storage = "Kiste 1"))
        assertEquals("Theme and storage location together", listOf("10001-1"), setsOffline(theme = "Castle", storage = "Kiste 1"))
        assertEquals("Sorting by name", listOf("21000-1", "10001-1", "10002-1", "30000-1", "10003-1"),
            setsOffline(sort = SetSort.NAME))
    }

    @Test
    fun `a percent sign or underscore in the search counts literally`() {
        loadSetsOnline()
        offline = true
        assertEquals(listOf("30000-1"), setsOffline(search = "50_%"))
        assertEquals("„_“ is no placeholder for a character", emptyList<String>(), setsOffline(search = "Burg_am"))
    }

    @Test
    fun `color, category, spare parts and search of the parts list work offline`() {
        runBlocking { assertTrue(partsRepo.refreshParts() is Outcome.Success) }
        offline = true
        assertEquals(listOf("3001/Red", "3023/Red"), partsOffline(color = "Red"))
        assertEquals(listOf("3001/Red"), partsOffline(color = "Red", spare = SparePartChoice.WITHOUT))
        assertEquals(listOf("3023/Red"), partsOffline(spare = SparePartChoice.ONLY))
        assertEquals(listOf("3069b/Blue"), partsOffline(category = "19"))
        assertEquals("Search in the name", listOf("3023/Red"), partsOffline(search = "plate"))
        assertEquals("Search in the BrickLink number", listOf("3069b/Blue"), partsOffline(search = "87079"))
        assertEquals(listOf("3001/Red", "3001/Blue"), partsOffline(search = "3001"))
    }

    @Test
    fun `the gallery filters in Room, the fetch only fills the store`() = runBlocking {
        assertTrue(setsRepo.refreshSets() is Outcome.Success)
        assertEquals("all sets in the store", sets.size, setsRepo.observeSets().first().list.size)
        val city = setsRepo.observeSets(theme = "City", sort = SetSort.NUMBER).first().list.map { it.setNumber }
        assertEquals("the gallery filters in Room and sorts like the server", listOf("10002-1", "21000-1"), city)
        offline = true
        assertTrue("without network the fetch reports the error", setsRepo.refreshSets() is Outcome.Failure)
        assertEquals("and the store stays", sets.size, setsRepo.observeSets().first().list.size)
    }

    @Test
    fun `the parts go into the store whole and filter there`() = runBlocking {
        assertTrue(partsRepo.refreshParts() is Outcome.Success)
        assertEquals("all pages of the parts in the store", parts.size, partsRepo.observeParts().first().list.size)
        assertEquals("the manual parts likewise", listOf("m1"), partsRepo.observeManualParts().first().list.map { it.partNumber })
        val red = partsRepo.observeParts(color = ColorPicker.Color("Red"), spareParts = SparePartChoice.WITHOUT).first().list.map { it.partNumber }
        assertEquals("Color and spare parts filter in Room", listOf("3001"), red)
    }

    private companion object {
        const val STATUS = 42L

        /** Every method of the interface not overridden here is a fault of the test. */
        inline fun <reified A> fake(): A = Proxy.newProxyInstance(A::class.java.classLoader, arrayOf(A::class.java)) { _, m, _ ->
            error("unerwarteter Aufruf ${m.name}")
        } as A
    }
}
