package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.AccountSelection
import ch.brickinventoryapp.state.ui.FilterStore
import ch.brickinventoryapp.state.ui.Scope
import ch.brickinventoryapp.state.ui.ScopeService
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * The Blickfeld service — account filter, storage filter, household accounts — run
 * against an in-memory store and a test server.
 *
 * Counter-checks (measured 28.10.2026, kotlinc against Blickfeld.kt):
 *   A  in loadMembers() the fallback to ALL removed → red „ein Filter auf ein Konto, das nicht mehr dazugehört, fällt auf alle zurück“
 *   B  in loadFilter() taking over the storage filters removed → red „die gemerkten Filter kommen aus der Ablage“
 *   C  in loginBegins() `store.forgetAll()` removed → red „eine Anmeldung beginnt mit allen Konten“
 */
class ScopeTest {

    /** In-memory store that records what's written. */
    private class Store : FilterStore {
        val accounts = mutableMapOf<String, String>()
        val storage = mutableMapOf<String, String>()
        override suspend fun account(view: ScopeFilter.View) = accounts[view.key] ?: ScopeFilter.ALL
        override suspend fun storage(view: ScopeFilter.View) = storage[view.key] ?: ""
        override suspend fun setAccount(view: ScopeFilter.View, value: String) { accounts[view.key] = value }
        override suspend fun applyStorage(view: ScopeFilter.View, value: String) { storage[view.key] = value }
        override suspend fun forgetAll() { accounts.clear(); storage.clear() }
    }

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File
    private lateinit var store: Store
    private lateinit var glance: Scope

    @Before
    fun setUp() {
        server = MockWebServer().apply { start() }
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-blick-${System.nanoTime()}").apply { mkdirs() }
        val api = TestApi.forTarget(server)
        store = Store()
        glance = ScopeService(store, testHouseholdRepository(api), testPartsRepository(api))
    }

    @After
    fun tearDown() {
        server.shutdown()
        cacheDir.deleteRecursively()
    }

    @Test(timeout = 5000)
    fun `the remembered filters come from the store`() = runTest {
        store.accounts["gallery"] = "own"
        store.storage["parts"] = "Kiste 3"
        glance.loadFilter()
        assertEquals(AccountSelection.Own, glance.accountFor(ScopeFilter.View.GALLERY))
        assertNull("„alle“ reist nicht als Parameter mit", glance.accountFor(ScopeFilter.View.PARTS))
        assertEquals("Kiste 3", glance.storageFor(ScopeFilter.View.PARTS))
    }

    @Test
    fun `a set filter is remembered and applies immediately`() = runTest {
        glance.setAccount(ScopeFilter.View.FINANCE, "7")
        assertEquals("7", store.accounts["finance"])
        assertEquals(AccountSelection.Account(7), glance.accountFor(ScopeFilter.View.FINANCE))
    }

    @Test
    fun `a filter on an account that no longer belongs falls back to all`() = runTest {
        glance.setAccount(ScopeFilter.View.GALLERY, "9")
        glance.setAccount(ScopeFilter.View.PARTS, "7")
        server.enqueue(TestApi.response("""{"success":true,"members":[
            {"id":1,"username":"marco","is_self":true},{"id":7,"username":"kind"}]}"""))
        glance.loadMembers()
        assertEquals(2, glance.accounts.value.householdMembers.size)
        assertNull("Konto 9 gibt es nicht mehr", glance.accountFor(ScopeFilter.View.GALLERY))
        assertEquals(AccountSelection.Account(7), glance.accountFor(ScopeFilter.View.PARTS))
    }

    @Test
    fun `a sign-in starts with all accounts`() = runTest {
        glance.setAccount(ScopeFilter.View.GALLERY, "own")
        glance.applyStorage(ScopeFilter.View.GALLERY, "Regal")
        glance.loginBegins()
        assertTrue(store.accounts.isEmpty() && store.storage.isEmpty())
        assertNull(glance.accountFor(ScopeFilter.View.GALLERY))
        assertNull(glance.storageFor(ScopeFilter.View.GALLERY))
    }
}
