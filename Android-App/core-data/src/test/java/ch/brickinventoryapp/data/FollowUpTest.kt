package ch.brickinventoryapp.data

import ch.brickinventoryapp.contract.FigValuationItem
import ch.brickinventoryapp.contract.KontoName
import ch.brickinventoryapp.contract.Merkposten
import ch.brickinventoryapp.contract.PartValuationItem
import ch.brickinventoryapp.contract.SetItem
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.collection.SetsRepositoryImpl
import ch.brickinventoryapp.data.collection.WantedListRepositoryImpl
import ch.brickinventoryapp.data.parts.FiguresRepositoryImpl
import ch.brickinventoryapp.data.parts.PartsRepositoryImpl
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OutboxStorage
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.StorageInventory
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

/**
 * What only works online also lands in the store: every write applies
 * the server's response via applyChange, so that the lists that read solely from the
 * store are right immediately — without a signal and without a new fetch.
 *
 * Counter-checks (kotlinc and JUnit against the repositories and LocalApplication.kt):
 *   A  in SetsRepositoryImpl.setSetStorage again only `safeCall` → red “quantity, storage location …”
 *   B  in LocalApplication's wishlist the branch WantedItemMoved removed → red
 *      “a moved and a taken-over wishlist item …”
 *   C  in LocalApplication the branch PartColor set to `list` → red “storage location and
 *      color of a part …”
 *   D  in PartsRepositoryImpl.renameLocation the follow-up omitted → red “a
 *      renamed location has the new name everywhere”
 *   E  in Fetch.kt applyInSameArea without the comparison of the area → red
 *      “a response while the account changes …”
 *   F  in caughtUp() the effect applied even without `success` → red “a
 *      rejected change does not change the store”
 */
class FollowUpTest {

    // The test server applies it on its own thread.
    @Volatile private var area: String? = "a"
    private val store = OfflineStore(StorageInventory(), OutboxStorage(), { area })
    private val paths = PathServer(
        "/api/v1/sets/10001-1" to """{"success":true,"quantity":3}""",
        "/api/v1/sets/10001-1/storage" to """{"success":true,"storage":"Kiste 2"}""",
        "/api/v1/sets/10001-1/move" to """{"success":true,"set_number":"10001-1"}""",
        "/api/v1/wanted/20001-1/N/inhaber" to """{"success":true,"verschoben":true}""",
        "/api/v1/wanted/20002-1/N/uebernehmen" to """{"success":true,"action":"added","set_number":"20002-1"}""",
        "/api/v1/parts/3001/5/storage" to """{"success":true,"storage":"Regal"}""",
        "/api/v1/parts/3001/5/color" to """{"success":true,"zusammengelegt":true}""",
        "/api/v1/minifigs/sw0001/storage" to """{"success":true,"storage":"Regal"}""",
        "/api/v1/storage/locations/3" to """{"success":true,"ort":{"id":3,"name":"Keller"}}""",
    )
    private val api = paths.onTick()
    private val sets = SetsRepositoryImpl(api, store, RetryPolicy.ONCE)
    private val wantedList = WantedListRepositoryImpl(api, store, RetryPolicy.ONCE)
    private val parts = PartsRepositoryImpl(api, store, RetryPolicy.ONCE)
    private val figures = FiguresRepositoryImpl(api, store, RetryPolicy.ONCE)

    @Before
    fun setUp() = runBlocking {
        store.adopt(Slots.SETS, listOf(SetItem(setNumber = "10001-1", quantity = 1, storage = "Kiste 1",
            owners = listOf(KontoName(id = 1, username = "anna"), KontoName(id = 2, username = "ben")))).map { it.asView() })
        store.adopt(Slots.WANTED_LIST, listOf(Merkposten(setNumber = "20001-1", condition = Condition.NEW, userId = 1),
            Merkposten(setNumber = "20002-1", condition = Condition.NEW, userId = 1)).map { it.asView() })
        store.adopt(Slots.MANUAL_PARTS, listOf(PartValuationItem(partNumber = "3001", colorId = 5, quantity = 2, storage = "Kiste 1"),
            PartValuationItem(partNumber = "3001", colorId = 7, quantity = 4)).map { it.asView() })
        store.adopt(Slots.MANUAL_FIGURES, listOf(FigValuationItem(figNumber = "sw0001", storage = "Kiste 1")).map { it.asView() })
    }

    @After
    fun tearDown() = paths.server.shutdown()

    private fun set() = runBlocking { store.read(Slots.SETS)!!.list.single { it.setNumber == "10001-1" } }

    @Test
    fun `quantity, storage location and owner of a set are in the store after the response`() = runBlocking {
        sets.setQuantity("10001-1", 5)
        assertEquals("the server's number, not the requested one", 3, set().quantity)
        sets.setSetStorage("10001-1", "kiste 2")
        assertEquals("the location as the server writes it", "Kiste 2", set().storage)
        sets.moveSet("10001-1", fromUserId = 1, toUserId = 2)
        assertEquals(listOf(2), set().owners.map { it.id })
        sets.deleteSet("10001-1")
        assertEquals(emptyList<String>(), store.read(Slots.SETS)!!.list.map { it.setNumber })
    }

    @Test
    fun `a moved and a taken-over wishlist item are in the store after the response`() = runBlocking {
        wantedList.moveWantedItem("20001-1", Condition.NEW, ofId = 1, toId = 2)
        wantedList.adoptWantedItem("20002-1", Condition.NEW, quantity = 2, ownerUserId = 1)
        assertEquals(listOf("20001-1|2"), store.read(Slots.WANTED_LIST)!!.list.map { "${it.setNumber}|${it.userId}" })
        assertEquals("taken over into the gallery", listOf("20002-1" to 2, "10001-1" to 1),
            store.read(Slots.SETS)!!.list.map { it.setNumber to it.quantity })
    }

    @Test
    fun `storage location and color of a part and the location of a figure are in the store after the response`() = runBlocking {
        parts.setPartStorage("3001", 5, "regal")
        assertEquals("Regal", store.read(Slots.MANUAL_PARTS)!!.list.first { it.colorId == 5 }.storage)
        // The new color already has a row: the server merges both.
        parts.setPartColor("3001", 5, newColor = 7, colorName = "Grün", colorHex = "00FF00")
        assertEquals(listOf(7 to 6), store.read(Slots.MANUAL_PARTS)!!.list.map { it.colorId to it.quantity })
        figures.setFigStorage("sw0001", "regal")
        assertEquals("Regal", store.read(Slots.MANUAL_FIGURES)!!.list.single().storage)
    }

    @Test
    fun `a renamed location has the new name everywhere`() = runBlocking {
        parts.renameLocation(3, old = "Kiste 1", name = "Keller")
        assertEquals("Keller", set().storage)
        assertEquals("Keller", store.read(Slots.MANUAL_PARTS)!!.list.first { it.colorId == 5 }.storage)
        assertEquals("Keller", store.read(Slots.MANUAL_FIGURES)!!.list.single().storage)
    }

    @Test
    fun `a response while the account changes does not change the new store`() = runBlocking {
        // The device holds only one account; the new one loads its set while the old response is on its way.
        paths.priority = { _, _ ->
            area = "b"
            runBlocking { store.adopt(Slots.SETS, listOf(SetItem(setNumber = "10001-1", quantity = 1)).map { it.asView() }) }
            null
        }
        sets.setQuantity("10001-1", 5)
        assertEquals("the new account's store", 1, set().quantity)
    }

    @Test
    fun `a rejected change does not change the store`() = runBlocking {
        paths.responses["/api/v1/sets/10001-1/storage"] = """{"success":false,"error":"Ort unbekannt"}"""
        sets.setSetStorage("10001-1", "x")
        assertEquals("Kiste 1", set().storage)
    }
}
