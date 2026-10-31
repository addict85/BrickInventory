package ch.brickinventoryapp

import ch.brickinventoryapp.data.api.Fehlerrumpf
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * Der Fehlercode des Servers (`code` im Rumpf) kommt in `Result.Error.code` an
 * und entscheidet dort, wo nach dem Fall verzweigt wird.
 *
 * Gegenproben (28.10.2026, gemessen mit kotlinc gegen die Datenschicht):
 *   A  in safeCall() `code = rumpf.code` weggelassen → rot „der Code des
 *      Servers kommt im Fehler an“
 *   B  in guthaben() wieder nach Status 429 statt nach Code verzweigt → rot
 *      „eine andere 429 bleibt ein Fehler mit Satz und Code“
 *   C  in guthaben() den gelesenen Rumpf nicht neu übergeben → rot „eine
 *      andere 429 …“ (Code fehlt)
 * Nicht messbar: die isNull-Prüfung in Fehlerrumpf.lies(). Das org.json der
 * Tests gibt für JSON-null ohnehin "" zurück, das von Android "null".
 */
class FehlercodeTest {

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File

    @Before
    fun auf() {
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-code-${System.nanoTime()}").apply { mkdirs() }
    }

    @After
    fun zu() {
        server.shutdown()
        cacheDir.deleteRecursively()
    }

    private fun admin() = KontoRepository(TestApi.fuer(server), ResponseCache { cacheDir })
    private fun gutscheine() = GutscheineRepository(TestApi.fuer(server), ResponseCache { cacheDir })

    private fun fehler(r: Result<*>): Result.Error {
        assert(r is Result.Error) { "Erwartet wurde ein Fehler, kam: $r" }
        return r as Result.Error
    }

    @Test
    fun `der Code des Servers kommt im Fehler an`() = runTest {
        server.enqueue(TestApi.antwort(
            """{"success":false,"error":"Aktuelles Passwort falsch","code":"aktuelles_passwort_falsch"}""", 400))
        val e = fehler(admin().getMe())
        assertEquals("aktuelles_passwort_falsch", e.code)
        assertEquals("Aktuelles Passwort falsch", e.message)
        assertEquals(400, e.httpCode)
    }

    @Test
    fun `ein Rumpf ohne verwertbaren Code ergibt keinen`() = runTest {
        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>Bad Gateway</html>"))
        val e = fehler(admin().getMe())
        assertNull(e.code)
        assertEquals(Fehlerart.SERVER, e.art)

        assertNull(Fehlerrumpf.lies("""{"success":false,"code":null,"error":""}""").code)
        assertNull(Fehlerrumpf.lies("""{"success":false,"code":null,"error":""}""").text)
        assertEquals(Fehlerrumpf("Satz", "fall"), Fehlerrumpf.lies("""{"error":"Satz","code":"fall"}"""))
    }

    @Test
    fun `eine zurueckgestellte Guthabenabfrage ist eine Antwort mit Wartezeit`() = runTest {
        server.enqueue(TestApi.antwort(
            """{"success":false,"code":"guthaben_abstand","error":"Bitte warten","grund":"abstand","wartenSek":30}""", 429))
        when (val r = gutscheine().guthaben(1)) {
            is Result.Success -> {
                assertEquals("abstand", r.data.grund)
                assertEquals(30, r.data.wartenSek)
            }
            is Result.Error -> throw AssertionError("Die Wartezeit ging verloren: $r")
        }
    }

    @Test
    fun `eine andere 429 bleibt ein Fehler mit Satz und Code`() = runTest {
        server.enqueue(TestApi.antwort(
            """{"success":false,"code":"zu_viele_anfragen","error":"Zu viele Anfragen"}""", 429))
        val e = fehler(gutscheine().guthaben(1))
        assertEquals("zu_viele_anfragen", e.code)
        assertEquals("Zu viele Anfragen", e.message)
    }
}
