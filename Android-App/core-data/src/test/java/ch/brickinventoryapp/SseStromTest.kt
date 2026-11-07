package ch.brickinventoryapp

import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.SseEreignis
import ch.brickinventoryapp.data.Zugangsdaten
import ch.brickinventoryapp.data.sseStrom
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Der gemeinsame SSE-Baustein (sseStrom) gegen einen echten Testserver, und der
 * CSV-Client darauf: Ein unlesbares Ereignis darf nicht verschwinden, sonst wartet der
 * Aufrufer auf ein Abschlussereignis, das nie kommt.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   sse-unlesbar-verschluckt  onEvent ignoriert eine unlesbare Nutzlast wieder still (kein
 *                             trySend/close) → rot „ein unlesbares Ereignis beendet den
 *                             Strom sichtbar“ (das dritte Ereignis kommt an) und „der
 *                             CSV-Client meldet …“ (Grund ist „stream closed by server“)
 */
class SseStromTest {

    private val server = MockWebServer().apply { start() }
    private val client = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }

    @After
    fun zu() { server.shutdown() }

    private fun antwort(rumpf: String, code: Int = 200) = MockResponse().setResponseCode(code)
        .setHeader("Content-Type", "text/event-stream").setBody(rumpf)

    private fun anfrage() = Request.Builder().url(server.url("/strom")).build()

    private fun status(nutzlast: String) =
        json.parseToJsonElement(nutzlast).jsonObject["status"]!!.jsonPrimitive.content

    private fun <T> sammle(fluss: Flow<T>): List<T> =
        runBlocking { withTimeout(5_000) { fluss.toList() } }

    @Test
    fun `lesbare Ereignisse kommen der Reihe nach, der geschlossene Strom endet als Beendet`() {
        server.enqueue(antwort("data: {\"status\":\"running\"}\n\ndata: {\"status\":\"done\"}\n\n"))

        val ereignisse = sammle(sseStrom(client, anfrage()) { status(it) })

        assertEquals(
            listOf<SseEreignis<String>>(SseEreignis.Daten("running"), SseEreignis.Daten("done"), SseEreignis.Beendet),
            ereignisse,
        )
    }

    @Test
    fun `ein unlesbares Ereignis beendet den Strom sichtbar`() {
        // Das zweite Ereignis ist kein JSON; das dritte darf nicht mehr ankommen.
        server.enqueue(antwort(
            "data: {\"status\":\"running\"}\n\ndata: das ist kein json\n\ndata: {\"status\":\"done\"}\n\n"))

        val ereignisse = sammle(sseStrom(client, anfrage()) { status(it) })

        assertEquals(SseEreignis.Daten("running"), ereignisse[0])
        assertTrue("erwartet Unlesbar, war ${ereignisse[1]}", ereignisse[1] is SseEreignis.Unlesbar)
        assertEquals("nach dem Unlesbaren kommt nichts mehr", 2, ereignisse.size)
    }

    @Test
    fun `eine Fehlerantwort liefert Code und Rumpf, bevor die Antwort zu ist`() {
        server.enqueue(antwort("{\"error\":\"zu viele\",\"code\":\"zu_viele_verbindungen\"}", code = 429))

        val ereignisse = sammle(sseStrom(client, anfrage()) { status(it) })

        val fehler = ereignisse.single() as SseEreignis.Gescheitert
        assertEquals(429, fehler.code)
        assertTrue("Rumpf fehlt: ${fehler.rumpf}", fehler.rumpf!!.contains("zu_viele_verbindungen"))
    }

    @Test
    fun `der CSV-Client meldet ein unlesbares Ereignis als Failed`() {
        server.enqueue(antwort(
            "data: {\"success\":true,\"status\":\"running\",\"total\":3,\"done\":1}\n\ndata: [kaputt\n\n"))
        val zugang = object : Zugangsdaten {
            override suspend fun serverUrlJetzt() = server.url("/").toString()
            override suspend fun tokenJetzt() = "token"
        }

        val ereignisse = sammle(CsvImportSseClient(client, zugang, json).stream())

        assertEquals(1, (ereignisse[0] as CsvImportSseClient.Event.Status).status.done)
        val fehler = ereignisse[1] as CsvImportSseClient.Event.Failed
        // Das Ende des Servers wäre „stream closed by server“; hier muss es die Nutzlast sein.
        assertTrue("falscher Grund: ${fehler.technisch}", fehler.technisch!!.startsWith("unreadable event"))
        assertEquals(2, ereignisse.size)
    }
}
