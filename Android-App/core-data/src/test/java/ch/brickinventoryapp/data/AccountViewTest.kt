package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.repository.AccountView
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.SetsRepositoryImpl
import ch.brickinventoryapp.model.domain.AccountSelection
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.SetSort
import ch.brickinventoryapp.offline.Editing
import ch.brickinventoryapp.offline.OfflineStore
import ch.brickinventoryapp.offline.OutboxStorage
import ch.brickinventoryapp.offline.StorageInventory
import ch.brickinventoryapp.testing.PathServer
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.yield
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Two read models, clearly separated: the store (Room) holds the unfiltered collection
 * and answers search and filter itself; the account view asks the server, where it
 * splits quantities per account — and never ends up in the store.
 *
 * Counter-checks (kotlinc against AccountView.kt, Fetch.kt and SetsRepositoryImpl.kt):
 *   A  in Kontosicht.galerie `a.search` replaced by `null` → red “every filter of the
 *      account view is in the request”
 *   B  in Serversicht.aktualisiere additionally taken into the store → red “the
 *      account view does not end up in the store”
 *   C  in allPages the rows not merged by key (list instead of map)
 *      → red “the account view fetches all pages and no row twice”
 *   D  in Serversicht.beobachte the collecting of `store.altered` removed → red
 *      “a write shows up in the account view too”
 *   E  in Serversicht.beobachte the comparison of the area removed → red “the
 *      account view does not show a response for a different account”
 *   F  in refreshPaged applied even on an error → red “the full
 *      view is in the store and carries through a network outage”
 */
class AccountViewTest {

    private var area: String? = "a"
    private val store = OfflineStore(StorageInventory(), OutboxStorage(), { area })
    private val paths = PathServer(
        "/api/v1/sets" to """{"success":true,"total":2,"sets":[{"set_number":"10-1","name":"Haus"},{"set_number":"11-1","name":"Burg"}]}""",
    )
    private val api = paths.onTick()
    private val view = AccountView(api, api, api, store, RetryPolicy.ONCE)
    private val sets = SetsRepositoryImpl(api, store, RetryPolicy.ONCE)

    @After
    fun tearDown() = paths.server.shutdown()

    private fun query(accounts: AccountSelection = AccountSelection.Account(7)) =
        AccountView.SetsQuery(accounts, "falcon", "Star Wars", SetSort.PRICE_DESCENDING, "Regal 2")

    @Test
    fun `every filter of the account view is in the request`() = runBlocking {
        view.gallery.refresh(query())
        val path = paths.requestsTo("GET /api/v1/sets?").single()
        for (part in listOf("accounts=7", "search=falcon", "theme=Star%20Wars", "sort=price_desc", "storage=Regal%202")) {
            assertTrue("$part fehlt: $path", part in path)
        }
        assertEquals(listOf("10-1", "11-1"), view.gallery.observe(query()).first().list.map { it.setNumber })
    }

    @Test
    fun `the account view does not end up in the store`() = runBlocking {
        view.gallery.refresh(query())
        val stored = sets.observeSets().first()
        assertNull("nie geladen", stored.state)
        assertTrue(stored.list.isEmpty())
    }

    @Test
    fun `the account view fetches all pages and no row twice`() = runBlocking {
        paths.priority = { _, path ->
            if ("page=2" in path) 200 to """{"success":true,"total":3,"sets":[{"set_number":"11-1"},{"set_number":"12-1"}]}"""
            else 200 to """{"success":true,"total":3,"sets":[{"set_number":"10-1"},{"set_number":"11-1"}]}"""
        }
        view.gallery.refresh(query())
        assertEquals(listOf("10-1", "11-1", "12-1"), view.gallery.observe(query()).first().list.map { it.setNumber })
        assertEquals(2, paths.requestsTo("GET /api/v1/sets?").size)
    }

    @Test
    fun `a write shows up in the account view too`() = runBlocking {
        view.gallery.refresh(query())
        val before = paths.requestsTo("GET /api/v1/sets?").size
        val seen = CompletableDeferred<Unit>()
        val observer = launch { view.gallery.observe(query()).collect { seen.complete(Unit) } }
        // Only once the view observes does the change count: veraendert() leaves out the first state.
        seen.await()
        repeat(50) { yield() }
        // What a repository applies changes the store — the account view asks anew.
        store.applyChange(Editing.RecordSet(EntryRequest(setNumber = "12-1")))
        // The new request runs via the test server, thus on a foreign thread.
        withTimeoutOrNull(5_000) { while (paths.requestsTo("GET /api/v1/sets?").size <= before) delay(10) }
        observer.cancel()
        assertEquals("neu gefragt", before + 1, paths.requestsTo("GET /api/v1/sets?").size)
    }

    @Test
    fun `the account view does not show a response for a different account`() = runBlocking {
        view.gallery.refresh(query())
        area = "b"
        val l = view.gallery.observe(query()).first()
        assertNull(l.state)
        assertTrue(l.list.isEmpty())
    }

    @Test
    fun `the full view is in the store and carries through a network outage`() = runBlocking {
        assertTrue(sets.refreshSets() is Outcome.Success)
        val fetch = paths.requestsTo("GET /api/v1/sets?").single()
        assertTrue("ungefiltert: $fetch", "search=" !in fetch && "accounts=" !in fetch)
        paths.codes["/api/v1/sets"] = 500
        assertTrue(sets.refreshSets() is Outcome.Failure)
        val stored = sets.observeSets(theme = null).first()
        assertTrue("mit Stand", stored.state != null)
        assertEquals("ein Fehler leert die Ablage nicht", listOf("10-1", "11-1"), stored.list.map { it.setNumber })
        assertEquals("die Ablage beantwortet die Suche selbst", listOf("11-1"),
            sets.observeSets(search = "burg").first().list.map { it.setNumber })
    }
}
