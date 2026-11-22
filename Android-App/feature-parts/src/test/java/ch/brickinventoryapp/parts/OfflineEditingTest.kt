package ch.brickinventoryapp.parts

import ch.brickinventoryapp.data.local.Reconcile
import ch.brickinventoryapp.data.local.ReconcileOutcome
import ch.brickinventoryapp.data.local.ServerSender
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.testing.BrickApiService
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testMinifigsRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.data.testing.testWantedRepository
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OutboxStorage
import ch.brickinventoryapp.offline.Slots
import ch.brickinventoryapp.offline.StorageInventory
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.util.Collections

/**
 * Editing offline from start to end: repository, outbox and sender against
 * a test server that can drop the connection on request.
 *
 * Counter-checks:
 *   A  in the store's write (Fetch.kt) the branch for transient errors removed → red
 *      “without a connection the quantity goes into the outbox” (Ergebnis.Fehler instead of buffered)
 *   B  in the store's write (Fetch.kt) the check `store.waiting()` removed → red
 *      “if something waits, new things go behind it” (the second change went out directly)
 *   C  in ServerSender for SetQuantity `quantity = step` instead of `quantityDelta` →
 *      red “what is sent is the step”
 *   D  in Offlineablage.refreshPaged (Fetch.kt) the empty list taken over even on an
 *      error → red “without a connection the list stays in the store”
 *   (E–I measured)
 *   E  in the store's write (Fetch.kt) take a new key when buffering after the direct
 *      attempt (`buffer(editing)`) → red “… the same key”
 *   F  in PartsRepository.deletePart back to directly `safeCall` instead of `write` →
 *      red “deleted offline …” (Ergebnis.Fehler instead of buffered)
 *   G  in LocalApplication for DeletePart `filterNot` → `filter` → red “… disappears right away”
 *   H  in PartsRepository.updatePart no step → red “… as quantity and step”
 *   J  counter-checks/ausgang-schritt-verloren.patch: Stueckaenderung.asRequest without quantity_delta → red, the same test
 *   I  in ServerSender on delete `classify` instead of `deleteClassify` → red
 *      “an already deleted part …” (404 discarded and reported)
 */
class OfflineEditingTest {

    private class Server {
        @Volatile var offline = false
        /** The next request arrives, its answer is lost (a dead zone after sending). */
        @Volatile var responseLose = false
        val requests: MutableList<String> = Collections.synchronizedList(mutableListOf())
        /** Per request "METHOD path" → Idempotency-Key, null without one. */
        val key: MutableList<Pair<String, String?>> = Collections.synchronizedList(mutableListOf())
        val codes: MutableMap<String, Pair<Int, String>> = Collections.synchronizedMap(mutableMapOf())
        val mock = MockWebServer().apply {
            dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest): MockResponse {
                    val path = request.path.orEmpty().substringBefore('?')
                    requests += "${request.method} $path ${request.body.readUtf8()}"
                    key += "${request.method} $path" to request.getHeader("Idempotency-Key")
                    codes["${request.method} $path"]?.let { (c, r) -> return TestApi.response(r, c) }
                    return when {
                        request.method == "GET" && path == "/api/v2/sets" -> TestApi.response(
                            """{"success":true,"count":1,"total":1,"themes":[],"sets":[{"set_number":"10001-1","name":"Haus","quantity":1}]}""")
                        request.method == "GET" && path == "/api/v2/parts/manual" -> TestApi.response(
                            """{"success":true,"parts":[{"part_number":"3001","color_id":5,"quantity":5,"user_id":7},
                               {"part_number":"3002","color_id":1,"quantity":1,"user_id":7}]}""")
                        request.method == "GET" && path == "/api/v2/minifigs/manual" -> TestApi.response(
                            """{"success":true,"figs":[{"fig_number":"sw0001","quantity":2,"user_id":7}]}""")
                        request.method == "GET" && path == "/api/v2/wanted" -> TestApi.response(
                            """{"success":true,"item":[{"set_number":"20001-1","condition":"N","user_id":7}]}""")
                        else -> TestApi.response("""{"success":true}""")
                    }
                }
            }
            start()
        }
    }

    private val s = Server()
    private val cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-offline-${System.nanoTime()}")
    /** The test keeps the outbox to inspect it; the store does not show it. */
    private val outbox = OutboxStorage()
    private val store = OfflineStore(StorageInventory(), outbox, { "konto" })
    /** Without network: the connection never comes about in the first place, as in a dead zone. */
    private val api = retrofit2.Retrofit.Builder().baseUrl(s.mock.url("/"))
        .client(okhttp3.OkHttpClient.Builder().addInterceptor { chain ->
            if (s.offline) throw ConnectException("kein Netz")
            val response = chain.proceed(chain.request())
            if (s.responseLose) {
                s.responseLose = false
                response.close()
                throw SocketTimeoutException("Antwort verloren")
            }
            response
        }.build())
        .addConverterFactory(BrickJson.asConverterFactory("application/json".toMediaType()))
        .build().create(BrickApiService::class.java)
    private val repo = testSetsRepository(api, store)
    private val wantedList = testWantedRepository(api, store)
    private val parts = testPartsRepository(api, store)
    private val figures = testMinifigsRepository(api, store)
    private val sync = Reconcile(store, outbox, ServerSender(api, api, api))

    @After
    fun tearDown() {
        s.mock.shutdown()
        cacheDir.deleteRecursively()
    }

    @Test
    fun `without a connection the quantity goes into the outbox and the step is sent`() = runBlocking {
        assertTrue(repo.refreshSets() is Outcome.Success)
        s.offline = true
        val r = repo.changeQuantityBy("10001-1", 1)
        assertTrue("Expected: saved offline, got $r", r is Outcome.Success && r.buffered)
        assertEquals(2, store.read(Slots.SETS)!!.list.single().quantity)
        assertEquals(listOf(Editing.SetQuantity("10001-1", 1)), outbox.all("konto").map { it.editing })

        assertEquals(ReconcileOutcome.LATER, sync.send())
        s.offline = false
        assertEquals(ReconcileOutcome.DONE, sync.send())
        assertEquals(listOf("PUT /api/v2/sets/10001-1 {\"quantity_delta\":1}"), s.requests.filter { it.startsWith("PUT") })
        assertEquals(0, outbox.all("konto").size)
    }

    @Test
    fun `without a connection the list stays in the store, including its state`() = runBlocking {
        repo.refreshSets()
        s.offline = true
        repo.changeQuantityBy("10001-1", 1)
        val r = repo.refreshSets()
        assertTrue("Expected: a transient error, got $r", r is Outcome.Failure && r.transient)
        val l = repo.observeSets().first()
        assertTrue("with the state of the last server response", l.state != null)
        assertEquals(2, l.list.single().quantity)
    }

    @Test
    fun `if something waits, new things go behind it`() = runBlocking {
        repo.refreshSets()
        s.offline = true
        repo.changeQuantityBy("10001-1", 1)
        s.offline = false
        // The server is back, but the outbox has not been sent yet:
        // a direct request overtook the first change.
        val r = repo.changeQuantityBy("10001-1", 1)
        assertTrue(r is Outcome.Success && r.buffered)
        assertEquals(emptyList<String>(), s.requests.filter { it.startsWith("PUT") })
        sync.send()
        assertEquals(2, s.requests.count { it.startsWith("PUT /api/v2/sets/10001-1") })
    }

    @Test
    fun `online a change goes directly and is also local`() = runBlocking {
        repo.refreshSets()
        val r = repo.changeQuantityBy("10001-1", 2)
        assertTrue(r is Outcome.Success && !r.buffered)
        assertEquals(1, s.requests.count { it.startsWith("PUT") })
        assertEquals(3, store.read(Slots.SETS)!!.list.single().quantity)
    }

    @Test
    fun `if the server rejects, it is discarded and reported`() = runBlocking {
        s.offline = true
        repo.addSet("99999-1")
        s.codes["POST /api/v2/sets"] = 404 to """{"success":false,"error":"Set unbekannt"}"""
        s.offline = false
        assertEquals(ReconcileOutcome.DONE, sync.send())
        val v = sync.discarded().first().single()
        assertEquals("99999-1", v.target)
        assertEquals("Set unbekannt", v.message)
        assertEquals(0, outbox.all("konto").size)
    }

    @Test
    fun `a direct attempt whose response is lost and its retry carry the same key`() = runBlocking {
        repo.refreshSets()
        s.responseLose = true
        val r = repo.changeQuantityBy("10001-1", 1)
        assertTrue("Expected: buffered after a lost response, got $r", r is Outcome.Success && r.buffered)
        assertEquals(ReconcileOutcome.DONE, sync.send())
        val puts = s.key.filter { it.first == "PUT /api/v2/sets/10001-1" }.map { it.second }
        assertEquals(2, puts.size)
        assertTrue("without key: $puts", !puts[0].isNullOrBlank())
        assertEquals("the server must be able to recognize the repetition", puts[0], puts[1])
    }

    @Test
    fun `parts, figures and wishlist items deleted offline disappear immediately and go out later with a key`() = runBlocking {
        parts.refreshParts(); figures.refreshMinifigs(); wantedList.refreshWanted()
        s.offline = true
        for (r in listOf(parts.deletePart("3001", 5, owner = 7), figures.deleteMinifig("sw0001", owner = 7),
                         wantedList.deleteWantedItem("20001-1", Condition.NEW, 7)))
            assertTrue("Expected: saved offline, got $r", r is Outcome.Success && r.buffered)
        assertEquals("the deleted part disappears right away", listOf("3002"),
            store.read(Slots.MANUAL_PARTS)!!.list.map { it.partNumber })
        assertEquals(emptyList<String>(), store.read(Slots.MANUAL_FIGURES)!!.list.map { it.figNumber })
        assertEquals(emptyList<String>(), store.read(Slots.WANTED_LIST)!!.list.map { it.setNumber })
        assertEquals(listOf("3002"), parts.observeManualParts().first().list.map { it.partNumber })

        s.offline = false
        assertEquals(ReconcileOutcome.DONE, sync.send())
        val deleted = s.key.filter { it.first.startsWith("DELETE") }
        assertEquals(listOf("DELETE /api/v2/parts/3001/5", "DELETE /api/v2/minifigs/sw0001", "DELETE /api/v2/wanted/20001-1/N"),
            deleted.map { it.first })
        assertTrue("each with its own key: $deleted", deleted.mapNotNull { it.second }.toSet().size == 3)
        assertEquals(0, outbox.all("konto").size)
    }

    @Test
    fun `an already deleted part counts as deleted when sending and is not reported as discarded`() = runBlocking {
        parts.refreshParts()
        s.offline = true
        parts.deletePart("3001", 5)
        s.codes["DELETE /api/v2/parts/3001/5"] = 404 to """{"success":false,"error":"Teil nicht gefunden"}"""
        s.offline = false
        assertEquals(ReconcileOutcome.DONE, sync.send())
        assertEquals(emptyList<String>(), sync.discarded().first().map { it.target })
        assertEquals(0, outbox.all("konto").size)
    }

    @Test
    fun `a quantity change on part and figure travels as quantity and step`() = runBlocking {
        parts.refreshParts(); figures.refreshMinifigs()
        assertTrue(parts.updatePart("3001", 5, quantity = 7, unitPrice = null) is Outcome.Success)
        assertTrue(figures.updateMinifig("sw0001", quantity = 1, unitPrice = null) is Outcome.Success)
        val part = s.requests.single { it.startsWith("PUT /api/v2/parts/3001/5") }
        assertTrue(part, "\"quantity\":7" in part && "\"quantity_delta\":2" in part)
        val figure = s.requests.single { it.startsWith("PUT /api/v2/minifigs/sw0001") }
        assertTrue(figure, "\"quantity\":1" in figure && "\"quantity_delta\":-1" in figure)
        assertEquals("the local list shows the new quantity", 7,
            store.read(Slots.MANUAL_PARTS)!!.list.first { it.partNumber == "3001" }.quantity)
    }
}
