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
import ch.brickinventoryapp.testing.ReihenServer
import ch.brickinventoryapp.testing.TestApi

/**
 * PfadServer.imTakt liest jede Antwort gegen das DTO der aufgerufenen Methode. Eine
 * unvollständige Testantwort scheitert so im aufrufenden Faden, statt über
 * Dispatchers.Default zurückzukommen und den Test aus dem Takt zu werfen.
 *
 * Gegenproben (gemessen mit kotlinc lokal):
 *   A  in imTakt den Aufruf von pruefeGegenDto gestrichen → rot „eine unvollständige
 *      Antwort scheitert …“ (SerializationException statt AssertionError)
 *   B  pruefeEinlesen prüft die Liste nicht → rot „das Aufräumen nennt …“
 *   C  SofortRuf fragt bleibtAus nicht → rot „eine zurückgehaltene Antwort …“
 *   D  in senden() `isCanceled` nicht geprüft → rot „ein abgebrochener Abruf …“
 *   E  ReihenServer ohne vorrang (nach Pfad statt Reihe) → rot „der ReihenServer …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PfadServerImTaktTest {

    private val pfade = PfadServer(
        "/api/v1/finance/parts-valuation" to """{"success":true,"parts":[]}""",
        "/api/v1/finance/minifigs-valuation" to """{"success":true,"total_value":"0.00","figs":[]}""",
    )
    private val api = pfade.imTakt()

    @After
    fun zu() = pfade.server.shutdown()

    @Test
    fun `eine unvollständige Antwort scheitert im aufrufenden Faden`() {
        val faden = Thread.currentThread()
        try {
            runBlocking { api.getPartsValuation() }
            fail("Die Antwort ohne total_value wurde gelesen")
        } catch (e: AssertionError) {
            assertSame(faden, Thread.currentThread())
            assertTrue(e.message, "parts-valuation" in e.message.orEmpty() && "total_value" in e.message.orEmpty())
        }
        assertEquals(1, pfade.einlesefehler.size)
    }

    @Test
    fun `eine vollständige Antwort kommt an, und das Aufräumen bleibt still`() {
        val antwort = runBlocking { api.getMinifigsValuation() }
        assertEquals("0.00", antwort.body()?.totalValue)
        pfade.pruefeEinlesen()
    }

    @Test
    fun `das Aufräumen nennt die unpassende Antwort`() {
        assertSame("TestDienste findet den Server über den Dienst", pfade, PfadServer.von(api))
        runCatching { runBlocking { api.getPartsValuation() } }
        try {
            pfade.pruefeEinlesen()
            fail("pruefeEinlesen blieb still")
        } catch (e: AssertionError) {
            assertTrue(e.message, "GET /api/v1/finance/parts-valuation" in e.message.orEmpty())
        }
    }

    @Test
    fun `eine zurückgehaltene Antwort kommt erst mit freigeben, ohne Wanduhr`() = runTest {
        pfade.ausbleibend += "/api/v1/finance/minifigs-valuation"
        val abruf = launch { api.getMinifigsValuation() }
        runCurrent()
        assertTrue("Der Abruf wartet noch", abruf.isActive)
        assertTrue(pfade.anfragen.isEmpty())
        pfade.freigeben()
        runCurrent()
        assertTrue("Nach dem Freigeben ist er fertig", abruf.isCompleted)
        assertEquals(listOf("GET /api/v1/finance/minifigs-valuation"), pfade.anfragen.toList())
    }

    @Test
    fun `ein abgebrochener Abruf bekommt nach dem Freigeben keine Antwort`() = runTest {
        pfade.ausbleibend += "/api/v1/finance/minifigs-valuation"
        val abruf = launch { api.getMinifigsValuation() }
        runCurrent()
        abruf.cancel()
        pfade.freigeben()
        runCurrent()
        assertTrue("Der Server hat nichts gesehen: ${pfade.anfragen}", pfade.anfragen.isEmpty())
    }

    @Test
    fun `der ReihenServer antwortet in Reihenfolge und zeichnet die Anfragen auf`() {
        val reihe = ReihenServer()
        try {
            reihe.enqueue(TestApi.antwort("""{"success":true,"total_value":"1.00","figs":[]}"""))
            reihe.enqueue(TestApi.antwort("""{"success":true,"total_value":"2.00","figs":[]}"""))
            val werte = runBlocking { List(2) { reihe.api.getMinifigsValuation().body()?.totalValue } }
            assertEquals(listOf("1.00", "2.00"), werte)
            assertEquals(2, reihe.requestCount)
            assertEquals("/api/v1/finance/minifigs-valuation", reihe.takeRequest().path)
            reihe.pruefeEinlesen()
        } finally {
            reihe.shutdown()
        }
    }
}
