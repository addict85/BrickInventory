package ch.brickinventoryapp.data

import ch.brickinventoryapp.model.domain.SetRecorded
import ch.brickinventoryapp.testing.TestApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Creating a set via the shared SSE reader (sseStream): every outcome ends with exactly
 * one last step, and only „never arrived“ is NoConnection — only that may
 * the outbox retry without creating twice.
 *
 * Counter-checks (patches under gegenproben/):
 *   anlegen-json-form-als-abbruch   withoutStream() without the branch for 2xx → red “the JSON form …”
 *   anlegen-absage-ohne-satz        errorTextFrom() always returns "" → red “a refusal carries …”
 *   anlegen-abgelehnt-als-abbruch   sseStream never sets noConnection → red “without a server …”
 *   anlegen-ende-ohne-abschluss     Beendet without step → red “an end without done …”
 */
class SetCreateStreamTest {

    private val server = MockWebServer().apply { start() }

    @After
    fun zu() { runCatching { server.shutdown() } }

    private fun schritte(): List<SetCreateStep> = runBlocking {
        withTimeout(5_000) {
            SetCreateSseClient(TestApi.umgeleitet(server), Dispatchers.IO).anlegen("10305", 1, null, null, null, null).toList()
        }
    }

    private fun strom(rumpf: String) = MockResponse().setHeader("Content-Type", "text/event-stream").setBody(rumpf)

    @Test
    fun `the JSON form is a finished creation, the existing set comes as a domain value`() {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody("""{"success":true,"action":"exists","set_number":"10305-1"}"""))
        assertEquals(listOf(SetCreateStep.Fertig(SetRecorded(nummer = "10305-1", vorhanden = true))), schritte())
    }

    @Test
    fun `a refusal carries the server's sentence`() {
        server.enqueue(MockResponse().setResponseCode(409).setHeader("Content-Type", "application/json")
            .setBody("""{"success":false,"error":"Set unbekannt"}"""))
        assertEquals(listOf(SetCreateStep.Fehler("Set unbekannt")), schritte())
    }

    @Test
    fun `a done with success false is an error with sentence, a done with success the completion`() {
        server.enqueue(strom("data: {\"step\":\"meta\",\"set\":\"Falke\"}\n\n" +
            "data: {\"step\":\"done\",\"success\":true,\"action\":\"added\",\"set_number\":\"10305-1\",\"ergaenzung\":\"ausstehend\"}\n\n"))
        server.enqueue(strom("data: {\"step\":\"done\",\"success\":false,\"error\":\"voll\"}\n\n"))
        assertEquals(listOf(SetCreateStep.Stammdaten("Falke"),
            SetCreateStep.Fertig(SetRecorded(nummer = "10305-1", angelegt = true, supplementPending = true))), schritte())
        assertEquals(listOf(SetCreateStep.Fehler("voll")), schritte())
    }

    @Test
    fun `an end without done is an abort, not a silent end`() {
        server.enqueue(strom("data: {\"step\":\"meta\",\"set\":\"Falke\"}\n\ndata: {\"step\":\"image\"}\n\n"))
        assertEquals(listOf(SetCreateStep.Stammdaten("Falke"), SetCreateStep.Bild, SetCreateStep.Fehler("")),
            schritte())
    }

    @Test
    fun `without a server it is KeineVerbindung, so that the outbox may step in`() {
        val umgeleitet = TestApi.umgeleitet(server)
        server.shutdown()
        val s = runBlocking {
            withTimeout(5_000) {
                SetCreateSseClient(umgeleitet, Dispatchers.IO).anlegen("10305", 1, null, null, null, null).toList()
            }
        }
        assertEquals(listOf(SetCreateStep.NoConnection), s)
    }
}
