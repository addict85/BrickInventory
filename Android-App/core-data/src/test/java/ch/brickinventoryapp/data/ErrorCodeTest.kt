package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.errorTextToCode
import ch.brickinventoryapp.model.domain.ErrorCode
import ch.brickinventoryapp.network.data.api.ErrorBody
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.testing.testAccountRepository
import ch.brickinventoryapp.testing.testVouchersRepository
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

/**
 * The server's error code (`code` in the body) arrives in `Outcome.Failure.code`
 * and decides where branching goes by case.
 *
 * Counter-checks:
 *   A  in safeCall() `code = body.code` omitted → red “the server's code
 *      arrives in the error”
 *   B  in balance() again branched by status 429 instead of by code → red
 *      “another 429 stays an error with sentence and code“
 *   C  in balance() the read body not passed anew → red “another
 *      429 …” (code missing)
 * Counter-checks:
 *   fehlercode-ohne-verbindungstext   `zu_viele_verbindungen` deleted from errorTextToCode()
 *      → red “upload lock, connection limit and page limit …”
 *   pdf-seitengrenze-als-gelesen      the code missed in fromPdf() → red “a PDF above
 *      the page limit …” (again a „half-read“ PDF instead of an error)
 * Not measurable: the isNull check in Fehlerrumpf.read(). The tests' org.json
 * returns "" for JSON null anyway, Android's returns "null".
 */
class ErrorCodeTest {

    private lateinit var server: MockWebServer
    private lateinit var cacheDir: File

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        cacheDir = File(System.getProperty("java.io.tmpdir"), "bim-code-${System.nanoTime()}").apply { mkdirs() }
    }

    @After
    fun tearDown() {
        server.shutdown()
        cacheDir.deleteRecursively()
    }

    private fun admin() = testAccountRepository(TestApi.forTarget(server))
    private fun vouchers() = testVouchersRepository(TestApi.forTarget(server))

    private fun error(r: Outcome<*>): Outcome.Failure {
        assert(r is Outcome.Failure) { "Erwartet wurde ein Fehler, kam: $r" }
        return r as Outcome.Failure
    }

    @Test
    fun `the server's code arrives in the error`() = runTest {
        server.enqueue(TestApi.response(
            """{"success":false,"error":"Aktuelles Passwort falsch","code":"aktuelles_passwort_falsch"}""", 400))
        val e = error(admin().getMe())
        assertEquals(ErrorCode.CURRENT_PASSWORD_WRONG, e.code)
        assertEquals("Aktuelles Passwort falsch", e.message)
        assertEquals(Outcome.Failure.Server(400, "Aktuelles Passwort falsch", ErrorCode.CURRENT_PASSWORD_WRONG), e)
    }

    @Test
    fun `a body without a usable code yields none`() = runTest {
        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>Bad Gateway</html>"))
        val e = error(admin().getMe())
        assertNull(e.code)
        assertEquals("Ohne Satz bleibt nur der Status", Outcome.Failure.Server(502), e)

        assertNull(ErrorBody.read("""{"success":false,"code":null,"error":""}""").code)
        assertNull(ErrorBody.read("""{"success":false,"code":null,"error":""}""").text)
        assertEquals(ErrorBody("Satz", "fall"), ErrorBody.read("""{"error":"Satz","code":"fall"}"""))
    }

    @Test
    fun `a deferred balance query is a response with a wait time`() = runTest {
        server.enqueue(TestApi.response(
            """{"success":false,"code":"guthaben_abstand","error":"Bitte warten","grund":"abstand","wartenSek":30}""", 429))
        when (val r = vouchers().balance(1)) {
            is Outcome.Success -> {
                assertEquals("abstand", r.data.reason)
                assertEquals(30, r.data.waitSec)
            }
            is Outcome.Failure -> throw AssertionError("Die Wartezeit ging verloren: $r")
        }
    }

    @Test
    fun `another 429 stays an error with sentence and code`() = runTest {
        server.enqueue(TestApi.response(
            """{"success":false,"code":"zu_viele_anfragen","error":"Zu viele Anfragen"}""", 429))
        val e = error(vouchers().balance(1))
        assertEquals(ErrorCode.TOO_MANY_REQUESTS, e.code)
        assertEquals("Zu viele Anfragen", e.message)
    }

    @Test
    fun `upload lock, connection limit and page limit each have their own sentence`() {
        val texts = listOf(ErrorCode.UPLOAD_RUNNING, ErrorCode.TOO_MANY_CONNECTIONS, ErrorCode.PDF_TOO_MANY_PAGES).map { errorTextToCode(it) }
        assertTrue("jeder dieser Codes hat einen Satz der App: $texts", texts.all { it != null })
        assertEquals("keine zwei teilen sich einen Satz", 3, texts.toSet().size)
        assertNull("sonst gilt der Satz des Servers", errorTextToCode(ErrorCode.TOO_MANY_REQUESTS))
        assertNull(errorTextToCode(null))
    }

    @Test
    fun `a PDF above the page limit is an error with sentence and code, not a half-read one`() = runTest {
        server.enqueue(TestApi.response(
            """{"success":false,"code":"pdf_zu_viele_seiten","error":"Das PDF hat 40 Seiten, höchstens 20 sind möglich."}""", 422))
        val e = error(vouchers().fromPdf("karten.pdf", "application/pdf", byteArrayOf(37, 80, 68, 70)))
        assertEquals(ErrorCode.PDF_TOO_MANY_PAGES, e.code)
        assertEquals("Das PDF hat 40 Seiten, höchstens 20 sind möglich.", e.message)
        assertEquals(422, (e as Outcome.Failure.Server).status)
    }
}
