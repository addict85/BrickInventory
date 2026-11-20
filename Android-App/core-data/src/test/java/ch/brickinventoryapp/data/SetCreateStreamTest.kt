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
 * Set anlegen über den gemeinsamen SSE-Leser (sseStream): Jeder Ausgang endet mit genau
 * einem letzten Schritt, und nur „nie angekommen“ ist NoConnection — nur das darf
 * der Ausgang wiederholen, ohne doppelt anzulegen.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   anlegen-json-form-als-abbruch   withoutStream() ohne den Zweig für 2xx → rot „die JSON-Form …“
 *   anlegen-absage-ohne-satz        errorTextFrom() gibt immer "" → rot „eine Absage trägt …“
 *   anlegen-abgelehnt-als-abbruch   sseStream setzt noConnection nie → rot „ohne Server …“
 *   anlegen-ende-ohne-abschluss     Beendet ohne Schritt → rot „ein Ende ohne done …“
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
    fun `die JSON-Form ist ein fertiges Anlegen, das vorhandene Set kommt als Fachwert`() {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody("""{"success":true,"action":"exists","set_number":"10305-1"}"""))
        assertEquals(listOf(SetCreateStep.Fertig(SetRecorded(nummer = "10305-1", vorhanden = true))), schritte())
    }

    @Test
    fun `eine Absage traegt den Satz des Servers`() {
        server.enqueue(MockResponse().setResponseCode(409).setHeader("Content-Type", "application/json")
            .setBody("""{"success":false,"error":"Set unbekannt"}"""))
        assertEquals(listOf(SetCreateStep.Fehler("Set unbekannt")), schritte())
    }

    @Test
    fun `ein done mit success false ist ein Fehler mit Satz, ein done mit Erfolg der Abschluss`() {
        server.enqueue(strom("data: {\"step\":\"meta\",\"set\":\"Falke\"}\n\n" +
            "data: {\"step\":\"done\",\"success\":true,\"action\":\"added\",\"set_number\":\"10305-1\",\"ergaenzung\":\"ausstehend\"}\n\n"))
        server.enqueue(strom("data: {\"step\":\"done\",\"success\":false,\"error\":\"voll\"}\n\n"))
        assertEquals(listOf(SetCreateStep.Stammdaten("Falke"),
            SetCreateStep.Fertig(SetRecorded(nummer = "10305-1", angelegt = true, supplementPending = true))), schritte())
        assertEquals(listOf(SetCreateStep.Fehler("voll")), schritte())
    }

    @Test
    fun `ein Ende ohne done ist ein Abbruch, kein stilles Ende`() {
        server.enqueue(strom("data: {\"step\":\"meta\",\"set\":\"Falke\"}\n\ndata: {\"step\":\"image\"}\n\n"))
        assertEquals(listOf(SetCreateStep.Stammdaten("Falke"), SetCreateStep.Bild, SetCreateStep.Fehler("")),
            schritte())
    }

    @Test
    fun `ohne Server ist es KeineVerbindung, damit der Ausgang einspringen darf`() {
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
