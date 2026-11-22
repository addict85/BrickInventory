package ch.brickinventoryapp.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.testing.testSetCatalogRepository
import ch.brickinventoryapp.testing.TestApi

/**
 * An already added set is opened, not silently increased — whether
 * via barcode, text recognition or number. The rule lies on the server
 * (utils/setAdd.ts): adding answers with `action = "exists"` and writes
 * nothing, so that it does not drift apart between the clients.
 *
 * This is checked, executed, in EntryViewModelTest (number path,
 * scanner, text recognition, error of the pre-query). Here: the pre-query against
 * a test server and the structure that the gallery evaluates the trigger.
 *
 * Counter-check: on getSetExists an
 * `@Query("accounts") accounts: String? = "own"` → red “the existence check
 * sends no account filter”.
 */
class AddExistingSetTest {

    /** Hide comments — the explanatory texts name the checked patterns themselves. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    /**
     * The question is „do I have this already?", not „do I see this right now?". Without
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

    @Test
    fun `the trigger is also evaluated and reset again`() {
        // A set trigger without a receiver would be ineffective — and without
        // resetting the same set could not be opened a second time.
        // The adding frame evaluates, the graph navigates.
        val nav = code(File(Sources.root, "collection/ui/EntryFrame.kt").readText() + "\n" +
            File(Sources.root, "collection/ui/CollectionGraph.kt").readText())
        // The FIELD is checked, not the name of the state before.
        assert(Regex("""\w+\.foundSet""").containsMatchIn(nav)) {
            "die Galerie beobachtet den Auslöser nicht — es passiert dann gar nichts"
        }
        assert(nav.contains("gallerySearchFoundConsumed()")) {
            "der Auslöser wird nicht zurückgesetzt"
        }
        assert(nav.contains("CollectionTarget.SetDetail(")) {
            "es wird nicht zur Detailansicht navigiert"
        }
    }
}
