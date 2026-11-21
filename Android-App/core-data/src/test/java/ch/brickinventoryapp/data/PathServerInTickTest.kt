package ch.brickinventoryapp.data

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
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.RowsServer
import ch.brickinventoryapp.testing.TestApi

/**
 * PfadServer.imTakt liest jede Antwort gegen das DTO der aufgerufenen Methode. Eine
 * unvollständige Testantwort scheitert so im aufrufenden Faden, statt über
 * Dispatchers.Default zurückzukommen und den Test aus dem Takt zu werfen.
 *
 * Gegenproben (gemessen mit kotlinc lokal):
 *   A  in imTakt den Aufruf von checkAgainstDto gestrichen → rot „eine unvollständige
 *      Antwort scheitert …“ (SerializationException statt AssertionError)
 *   B  pruefeEinlesen prüft die Liste nicht → rot „das Aufräumen nennt …“
 *   C  ImmediatelyCall fragt staysFrom nicht → rot „eine zurückgehaltene Antwort …“
 *   D  in senden() `isCanceled` nicht geprüft → rot „ein abgebrochener Abruf …“
 *   E  RowsServer ohne vorrang (nach Pfad statt Reihe) → rot „der RowsServer …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PathServerInTickTest {

    private val paths = PfadServer(
        "/api/v1/finance/parts-valuation" to """{"success":true,"parts":[]}""",
        "/api/v1/finance/minifigs-valuation" to """{"success":true,"total_value":"0.00","figs":[]}""",
    )
    private val api = paths.imTakt()

    @After
    fun zu() = paths.server.shutdown()

    @Test
    fun `an incomplete response fails in the calling thread`() {
        val thread = Thread.currentThread()
        try {
            runBlocking { api.getPartsValuation() }
            fail("Die Antwort ohne total_value wurde gelesen")
        } catch (e: AssertionError) {
            assertSame(thread, Thread.currentThread())
            assertTrue(e.message, "parts-valuation" in e.message.orEmpty() && "total_value" in e.message.orEmpty())
        }
        assertEquals(1, paths.readError.size)
    }

    @Test
    fun `a complete response arrives, and the cleanup stays silent`() {
        val antwort = runBlocking { api.getMinifigsValuation() }
        assertEquals("0.00", antwort.body()?.totalValue)
        paths.pruefeEinlesen()
    }

    @Test
    fun `the cleanup names the unsuitable response`() {
        assertSame("TestDienste findet den Server über den Dienst", paths, PfadServer.von(api))
        runCatching { runBlocking { api.getPartsValuation() } }
        try {
            paths.pruefeEinlesen()
            fail("pruefeEinlesen blieb still")
        } catch (e: AssertionError) {
            assertTrue(e.message, "GET /api/v1/finance/parts-valuation" in e.message.orEmpty())
        }
    }

    @Test
    fun `a held-back response comes only with release, without a wall clock`() = runTest {
        paths.ausbleibend += "/api/v1/finance/minifigs-valuation"
        val abruf = launch { api.getMinifigsValuation() }
        runCurrent()
        assertTrue("Der Abruf wartet noch", abruf.isActive)
        assertTrue(paths.requests.isEmpty())
        paths.freigeben()
        runCurrent()
        assertTrue("Nach dem Freigeben ist er fertig", abruf.isCompleted)
        assertEquals(listOf("GET /api/v1/finance/minifigs-valuation"), paths.requests.toList())
    }

    @Test
    fun `an aborted fetch gets no response after the release`() = runTest {
        paths.ausbleibend += "/api/v1/finance/minifigs-valuation"
        val abruf = launch { api.getMinifigsValuation() }
        runCurrent()
        abruf.cancel()
        paths.freigeben()
        runCurrent()
        assertTrue("Der Server hat nichts gesehen: ${paths.requests}", paths.requests.isEmpty())
    }

    @Test
    fun `the RowsServer responds in order and records the requests`() {
        val series = RowsServer()
        try {
            series.enqueue(TestApi.antwort("""{"success":true,"total_value":"1.00","figs":[]}"""))
            series.enqueue(TestApi.antwort("""{"success":true,"total_value":"2.00","figs":[]}"""))
            val werte = runBlocking { List(2) { series.api.getMinifigsValuation().body()?.totalValue } }
            assertEquals(listOf("1.00", "2.00"), werte)
            assertEquals(2, series.requestCount)
            assertEquals("/api/v1/finance/minifigs-valuation", series.takeRequest().path)
            series.pruefeEinlesen()
        } finally {
            series.shutdown()
        }
    }
}
