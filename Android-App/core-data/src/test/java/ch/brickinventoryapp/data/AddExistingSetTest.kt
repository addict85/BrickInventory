package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testSetCatalogRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * An already added set is opened, not silently increased — whether
 * via barcode, text recognition or number. The rule lies on the server
 * (`utils/setAdd.ts`): adding answers with `action = "exists"` and writes
 * nothing, so that it does not drift apart between the clients.
 *
 * This is checked, executed, in EntryViewModelTest (number path, scanner, text recognition,
 * error of the pre-query) and in the app's FoundSetOpensTest (the gallery opens the set and
 * resets the trigger). Here: the pre-query against a test server.
 *
 * Counter-check: on getSetExists an
 * `@Query("accounts") accounts: String? = "own"` → red “the existence check
 * sends no account filter”.
 */
class AddExistingSetTest {

    /**
     * The question is „do I have this already?“, not „do I see this right now?“. Without
     * accounts the server takes its default view — main AND sub-accounts, and
     * a set of a sub-account counts as present.
     */
    @Test
    fun `the existence check sends no account filter`() {
        val paths = PathServer("/api/v1/sets/exists/75192-1" to """{"success":true,"exists":false}""")
        try {
            val sets = testSetCatalogRepository(TestApi.forTarget(paths.server))
            runBlocking { sets.getSetExists("75192-1") }
            assertEquals(listOf("GET /api/v1/sets/exists/75192-1"), paths.requests.toList())
        } finally {
            paths.server.shutdown()
        }
    }
}
