package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.testSetFilesRepository
import ch.brickinventoryapp.model.domain.AccountSelection
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/** A test server for [block], shut down afterwards. */
private fun <T> withServer(block: (PathServer) -> T): T {
    val paths = PathServer()
    try { return block(paths) } finally { paths.server.shutdown() }
}

/**
 * The parts tab filters by color and category — like the web app.
 *
 * ── The actually notable part ──────────────────────────────────────
 *
 * The wiring was already there: `BrickApiService.getParts` has declared
 * `@Query("color")` and `@Query("category")` all along, and
 * `PartsRepository.getParts` passes both through. Nobody ever SET them.
 *
 * A half-finished function stands out in none of the existing checks:
 * a parameter with a default value is not dead code, and there was no
 * state field for it. Hence this test — it confirms that the two values
 * are REALLY sent along.
 *
 * Run against a test server: what the repository actually fetches. That
 * the filters travel along from the state and the scroll position is forgotten
 * is checked by PartsTest.
 *
 * Counter-check: in PartsRepository.getPartsFilterColors
 * `accounts` not passed on → red „die App ruft beide Filterlisten …“.
 */
class PartsFilterTest {

    @Test
    fun `the app calls both filter lists with the view`() = withServer { paths ->
        // Both with `accounts`: otherwise they would count differently in the household than the
        // list below them — exactly the bug the server had here.
        val parts = testPartsRepository(TestApi.forTarget(paths.server))
        runBlocking {
            parts.getPartsFilterColors(accounts = AccountSelection.Own)
            parts.getPartsCategories(accounts = AccountSelection.Own)
        }
        assertEquals(listOf("GET /api/v2/parts/colors?accounts=own", "GET /api/v2/parts/categories?accounts=own"),
            paths.requests.toList())
    }
}

/**
 * The CSV import can be cancelled — like in the web app.
 */
class CsvAbortTest {

    @Test
    fun `the app calls the abort address`() = withServer { paths ->
        runBlocking { testSetFilesRepository(TestApi.forTarget(paths.server)).cancelCsvImport() }
        assertEquals(listOf("POST /api/v2/sets/import/csv/cancel"), paths.requests.toList())
    }
}
