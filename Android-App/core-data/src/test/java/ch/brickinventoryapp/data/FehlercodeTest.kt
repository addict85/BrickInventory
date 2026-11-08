package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.data.model.Fehlercode
import ch.brickinventoryapp.netz.data.api.Fehlerrumpf
import ch.brickinventoryapp.data.api.fehlerTextZuCode
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.GutscheineRepository
import ch.brickinventoryapp.testing.KontoRepository
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.testing.TestApi

/**
 * Der Fehlercode des Servers (`code` im Rumpf) kommt in `Ergebnis.Error.code` an
 * und entscheidet dort, wo nach dem Fall verzweigt wird.
 *
 * Gegenproben:
 *   A  in safeCall() `code = rumpf.code` weggelassen → rot „der Code des
 *      Servers kommt im Fehler an“
 *   B  in guthaben() wieder nach Status 429 statt nach Code verzweigt → rot
 *      „eine andere 429 bleibt ein Fehler mit Satz und Code“
 *   C  in guthaben() den gelesenen Rumpf nicht neu übergeben → rot „eine
 *      andere 429 …“ (Code fehlt)
 * Gegenproben:
 *   fehlercode-ohne-verbindungstext   `zu_viele_verbindungen` aus fehlerTextZuCode()
 *      gestrichen → rot „Upload-Sperre, Verbindungsgrenze und Seitengrenze …“
 *   pdf-seitengrenze-als-gelesen      der Code in ausPdf() verfehlt → rot „ein PDF über
 *      der Seitengrenze …“ (wieder ein „halb gelesenes“ PDF statt eines Fehlers)
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

    private fun fehler(r: Ergebnis<*>): Ergebnis.Error {
        assert(r is Ergebnis.Error) { "Erwartet wurde ein Fehler, kam: $r" }
        return r as Ergebnis.Error
    }

    @Test
    fun `der Code des Servers kommt im Fehler an`() = runTest {
        server.enqueue(TestApi.antwort(
            """{"success":false,"error":"Aktuelles Passwort falsch","code":"aktuelles_passwort_falsch"}""", 400))
        val e = fehler(admin().getMe())
        assertEquals(Fehlercode.AKTUELLES_PASSWORT_FALSCH, e.code)
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
            is Ergebnis.Success -> {
                assertEquals("abstand", r.data.grund)
                assertEquals(30, r.data.wartenSek)
            }
            is Ergebnis.Error -> throw AssertionError("Die Wartezeit ging verloren: $r")
        }
    }

    @Test
    fun `eine andere 429 bleibt ein Fehler mit Satz und Code`() = runTest {
        server.enqueue(TestApi.antwort(
            """{"success":false,"code":"zu_viele_anfragen","error":"Zu viele Anfragen"}""", 429))
        val e = fehler(gutscheine().guthaben(1))
        assertEquals(Fehlercode.ZU_VIELE_ANFRAGEN, e.code)
        assertEquals("Zu viele Anfragen", e.message)
    }

    @Test
    fun `Upload-Sperre, Verbindungsgrenze und Seitengrenze haben je einen eigenen Satz`() {
        val texte = listOf(Fehlercode.UPLOAD_LAEUFT, Fehlercode.ZU_VIELE_VERBINDUNGEN, Fehlercode.PDF_ZU_VIELE_SEITEN).map { fehlerTextZuCode(it) }
        assertTrue("jeder dieser Codes hat einen Satz der App: $texte", texte.all { it != null })
        assertEquals("keine zwei teilen sich einen Satz", 3, texte.toSet().size)
        assertNull("sonst gilt der Satz des Servers", fehlerTextZuCode(Fehlercode.ZU_VIELE_ANFRAGEN))
        assertNull(fehlerTextZuCode(null))
    }

    @Test
    fun `ein PDF über der Seitengrenze ist ein Fehler mit Satz und Code, kein halb gelesenes`() = runTest {
        server.enqueue(TestApi.antwort(
            """{"success":false,"code":"pdf_zu_viele_seiten","error":"Das PDF hat 40 Seiten, höchstens 20 sind möglich."}""", 422))
        val e = fehler(gutscheine().ausPdf("karten.pdf", "application/pdf", byteArrayOf(37, 80, 68, 70)))
        assertEquals(Fehlercode.PDF_ZU_VIELE_SEITEN, e.code)
        assertEquals("Das PDF hat 40 Seiten, höchstens 20 sind möglich.", e.message)
        assertEquals(422, e.httpCode)
    }
}
