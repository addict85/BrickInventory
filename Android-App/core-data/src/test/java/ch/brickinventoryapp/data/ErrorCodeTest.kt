package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.Fehlercode
import ch.brickinventoryapp.network.data.api.Fehlerrumpf
import ch.brickinventoryapp.data.repository.errorTextToCode
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
import ch.brickinventoryapp.testing.testVouchersRepository
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.TestApi

/**
 * The server's error code (`code` in the body) arrives in `Ergebnis.Fehler.code`
 * and decides where branching goes by case.
 *
 * Counter-checks:
 *   A  in sicherAufrufen() `code = rumpf.code` omitted → red “the server's code
 *      arrives in the error”
 *   B  in guthaben() again branched by status 429 instead of by code → red
 *      “another 429 stays an error with sentence and code“
 *   C  in guthaben() the read body not passed anew → red “another
 *      429 …” (code missing)
 * Counter-checks:
 *   fehlercode-ohne-verbindungstext   `zu_viele_verbindungen` deleted from errorTextToCode()
 *      → red “upload lock, connection limit and page limit …”
 *   pdf-seitengrenze-als-gelesen      the code missed in fromPdf() → red “a PDF above
 *      the page limit …” (again a „half-read“ PDF instead of an error)
 * Not measurable: the isNull check in Fehlerrumpf.lies(). The tests' org.json
 * returns "" for JSON null anyway, Android's returns "null".
 */
class ErrorCodeTest {

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

    private fun admin() = testAccountRepository(TestApi.fuer(server))
    private fun gutscheine() = testVouchersRepository(TestApi.fuer(server))

    private fun fehler(r: Ergebnis<*>): Ergebnis.Fehler {
        assert(r is Ergebnis.Fehler) { "Erwartet wurde ein Fehler, kam: $r" }
        return r as Ergebnis.Fehler
    }

    @Test
    fun `the server's code arrives in the error`() = runTest {
        server.enqueue(TestApi.antwort(
            """{"success":false,"error":"Aktuelles Passwort falsch","code":"aktuelles_passwort_falsch"}""", 400))
        val e = fehler(admin().getMe())
        assertEquals(Fehlercode.AKTUELLES_PASSWORT_FALSCH, e.code)
        assertEquals("Aktuelles Passwort falsch", e.message)
        assertEquals(Ergebnis.Fehler.Server(400, "Aktuelles Passwort falsch", Fehlercode.AKTUELLES_PASSWORT_FALSCH), e)
    }

    @Test
    fun `a body without a usable code yields none`() = runTest {
        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>Bad Gateway</html>"))
        val e = fehler(admin().getMe())
        assertNull(e.code)
        assertEquals("Ohne Satz bleibt nur der Status", Ergebnis.Fehler.Server(502), e)

        assertNull(Fehlerrumpf.lies("""{"success":false,"code":null,"error":""}""").code)
        assertNull(Fehlerrumpf.lies("""{"success":false,"code":null,"error":""}""").text)
        assertEquals(Fehlerrumpf("Satz", "fall"), Fehlerrumpf.lies("""{"error":"Satz","code":"fall"}"""))
    }

    @Test
    fun `a deferred balance query is a response with a wait time`() = runTest {
        server.enqueue(TestApi.antwort(
            """{"success":false,"code":"guthaben_abstand","error":"Bitte warten","grund":"abstand","wartenSek":30}""", 429))
        when (val r = gutscheine().guthaben(1)) {
            is Ergebnis.Erfolg -> {
                assertEquals("abstand", r.data.grund)
                assertEquals(30, r.data.wartenSek)
            }
            is Ergebnis.Fehler -> throw AssertionError("Die Wartezeit ging verloren: $r")
        }
    }

    @Test
    fun `another 429 stays an error with sentence and code`() = runTest {
        server.enqueue(TestApi.antwort(
            """{"success":false,"code":"zu_viele_anfragen","error":"Zu viele Anfragen"}""", 429))
        val e = fehler(gutscheine().guthaben(1))
        assertEquals(Fehlercode.ZU_VIELE_ANFRAGEN, e.code)
        assertEquals("Zu viele Anfragen", e.message)
    }

    @Test
    fun `upload lock, connection limit and page limit each have their own sentence`() {
        val texts = listOf(Fehlercode.UPLOAD_LAEUFT, Fehlercode.ZU_VIELE_VERBINDUNGEN, Fehlercode.PDF_ZU_VIELE_SEITEN).map { errorTextToCode(it) }
        assertTrue("jeder dieser Codes hat einen Satz der App: $texts", texts.all { it != null })
        assertEquals("keine zwei teilen sich einen Satz", 3, texts.toSet().size)
        assertNull("sonst gilt der Satz des Servers", errorTextToCode(Fehlercode.ZU_VIELE_ANFRAGEN))
        assertNull(errorTextToCode(null))
    }

    @Test
    fun `a PDF above the page limit is an error with sentence and code, not a half-read one`() = runTest {
        server.enqueue(TestApi.antwort(
            """{"success":false,"code":"pdf_zu_viele_seiten","error":"Das PDF hat 40 Seiten, höchstens 20 sind möglich."}""", 422))
        val e = fehler(gutscheine().fromPdf("karten.pdf", "application/pdf", byteArrayOf(37, 80, 68, 70)))
        assertEquals(Fehlercode.PDF_ZU_VIELE_SEITEN, e.code)
        assertEquals("Das PDF hat 40 Seiten, höchstens 20 sind möglich.", e.message)
        assertEquals(422, (e as Ergebnis.Fehler.Server).status)
    }
}
