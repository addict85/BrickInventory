package ch.brickinventoryapp.data

import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.local.Reconcile
import ch.brickinventoryapp.data.local.ReconcileOutcome
import ch.brickinventoryapp.data.local.ServerSender
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.testing.InMemoryRoom
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Outbox items written by an app that still spoke API v1 go out over v2 after the update:
 * the disk holds domain edits in the frozen form 1, the request arises only when sending.
 *
 * Counter-checks:
 *   A  `@POST("api/v2/sets")` in SetsApi back to `api/v1/sets` → red “the set goes to v2”
 *   B  in ServerSender the owner of DeleteWantedItem dropped → red “the deletion names …”
 */
@RunWith(RobolectricTestRunner::class)
class OutboxAfterV2Test {

    private val room = InMemoryRoom(ApplicationProvider.getApplicationContext())
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        repeat(3) { server.enqueue(TestApi.response("""{"success":true}""")) }
        server.start()
    }

    @After
    fun tearDown() {
        server.shutdown()
        room.close()
    }

    @Test
    fun `items stored before the move to v2 are sent over v2`() = runBlocking {
        // Exactly the text the v1 app left on the disk (InitialForm, version 1).
        room.addRawOutboxRow("a", """{"type":"set_erfassen","anfrage":{"set_number":"10001-1","quantity":2,"condition":"U","owner_user_id":3}}""", 1, "k1")
        room.addRawOutboxRow("a", """{"type":"merkposten_loeschen","setNumber":"20001-1","zustand":"N","besitzer":3}""", 2, "k2")
        room.addRawOutboxRow("a", """{"type":"teil_aendern","partNumber":"3001","colorId":5,"anfrage":{"quantity":4},"besitzer":3}""", 3, "k3")
        val api = TestApi.forTarget(server)
        val sync = Reconcile(OfflineStore(room.stock, room.outbox, { "a" }), room.outbox, ServerSender(api, api, api))

        assertEquals(ReconcileOutcome.DONE, sync.send())

        val set = server.takeRequest()
        assertEquals("the set goes to v2", "POST /api/v2/sets", "${set.method} ${set.path}")
        val body = JSONObject(set.body.readUtf8())
        assertEquals("10001-1", body.getString("set_number"))
        assertEquals(2, body.getInt("quantity"))
        assertEquals("U", body.getString("condition"))
        assertEquals(3, body.getInt("owner_user_id"))
        assertEquals("k1", set.getHeader("Idempotency-Key"))
        val deletion = server.takeRequest()
        assertEquals("the deletion names set, condition and owner in the v2 path",
            "DELETE /api/v2/wanted/20001-1/N?owner_user_id=3", "${deletion.method} ${deletion.path}")
        val change = server.takeRequest()
        assertEquals("PUT /api/v2/parts/3001/5?owner=3", "${change.method} ${change.path}")
        assertEquals(4, JSONObject(change.body.readUtf8()).getInt("quantity"))
        assertEquals("nothing was discarded", emptyList<Any>(), room.outbox.discarded("a").first())
        assertEquals(0, room.outbox.count("a").first())
    }
}
