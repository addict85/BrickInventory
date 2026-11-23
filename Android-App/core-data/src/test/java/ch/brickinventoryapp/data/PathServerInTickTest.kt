package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.RowsServer
import ch.brickinventoryapp.data.testing.TestApi
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * PathServer.onTick reads every response against the DTO of the called method. An
 * incomplete test response thus fails in the calling thread instead of coming back via
 * Dispatchers.Default and throwing the test out of tick.
 *
 * Counter-checks (measured locally with kotlinc):
 *   A  in onTick the call of checkAgainstDto struck → red “an incomplete
 *      response fails …” (SerializationException instead of AssertionError)
 *   B  checkReadIn does not check the list → red “the cleanup names …”
 *   C  ImmediatelyCall does not ask staysFrom → red “a held-back response …”
 *   D  in send() `isCanceled` not checked → red “an aborted fetch …”
 *   E  RowsServer without vorrang (by path instead of order) → red “the RowsServer …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PathServerInTickTest {

    private val paths = PathServer(
        "/api/v2/finance/parts-valuation" to """{"success":true,"parts":[]}""",
        "/api/v2/finance/minifigs-valuation" to """{"success":true,"total_value":"0.00","figs":[]}""",
    )
    private val api = paths.onTick()

    @After
    fun tearDown() = paths.server.shutdown()

    @Test
    fun `an incomplete response fails in the calling thread`() {
        val thread = Thread.currentThread()
        try {
            runBlocking { api.getPartsValuation() }
            fail("The answer without total_value was read")
        } catch (e: AssertionError) {
            assertSame(thread, Thread.currentThread())
            assertTrue(e.message, "parts-valuation" in e.message.orEmpty() && "total_value" in e.message.orEmpty())
        }
        assertEquals(1, paths.readError.size)
    }

    @Test
    fun `a complete response arrives, and the cleanup stays silent`() {
        val response = runBlocking { api.getMinifigsValuation() }
        assertEquals("0.00", response.body()?.totalValue)
        paths.checkReadIn()
    }

    @Test
    fun `the cleanup names the unsuitable response`() {
        assertSame("TestServices finds the server via the service", paths, PathServer.of(api))
        runCatching { runBlocking { api.getPartsValuation() } }
        try {
            paths.checkReadIn()
            fail("pruefeEinlesen blieb still")
        } catch (e: AssertionError) {
            assertTrue(e.message, "GET /api/v2/finance/parts-valuation" in e.message.orEmpty())
        }
    }

    @Test
    fun `a held-back response comes only with release, without a wall clock`() = runTest {
        paths.missing += "/api/v2/finance/minifigs-valuation"
        val fetch = launch { api.getMinifigsValuation() }
        runCurrent()
        assertTrue("The fetch is still waiting", fetch.isActive)
        assertTrue(paths.requests.isEmpty())
        paths.release()
        runCurrent()
        assertTrue("After releasing it is done", fetch.isCompleted)
        assertEquals(listOf("GET /api/v2/finance/minifigs-valuation"), paths.requests.toList())
    }

    @Test
    fun `an aborted fetch gets no response after the release`() = runTest {
        paths.missing += "/api/v2/finance/minifigs-valuation"
        val fetch = launch { api.getMinifigsValuation() }
        runCurrent()
        fetch.cancel()
        paths.release()
        runCurrent()
        assertTrue("The server saw nothing: ${paths.requests}", paths.requests.isEmpty())
    }

    @Test
    fun `the RowsServer responds in order and records the requests`() {
        val series = RowsServer()
        try {
            series.enqueue(TestApi.response("""{"success":true,"total_value":"1.00","figs":[]}"""))
            series.enqueue(TestApi.response("""{"success":true,"total_value":"2.00","figs":[]}"""))
            val values = runBlocking { List(2) { series.api.getMinifigsValuation().body()?.totalValue } }
            assertEquals(listOf("1.00", "2.00"), values)
            assertEquals(2, series.requestCount)
            assertEquals("/api/v2/finance/minifigs-valuation", series.takeRequest().path)
            series.checkReadIn()
        } finally {
            series.shutdown()
        }
    }
}
