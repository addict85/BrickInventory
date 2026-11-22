package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.testing.TestApi
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
 * The shared SSE building block (sseStream) against a real test server, and the
 * CSV client on top of it: an unreadable event must not disappear, otherwise the
 * caller waits for a completion event that never comes.
 *
 * Counter-checks (patches under counter-checks/):
 *   sse-unlesbar-verschluckt  onEvent silently ignores an unreadable payload again (no
 *                             trySend/close) → red “an unreadable event ends the
 *                             stream visibly” (the third event arrives) and “the
 *                             CSV client reports …” (reason is „stream closed by server“)
 */
class SseStreamTest {

    private val server = MockWebServer().apply { start() }
    private val client = OkHttpClient()
    private val json = Json { ignoreUnknownKeys = true }

    @After
    fun tearDown() { server.shutdown() }

    private fun response(body: String, code: Int = 200) = MockResponse().setResponseCode(code)
        .setHeader("Content-Type", "text/event-stream").setBody(body)

    private fun request() = Request.Builder().url(server.url("/strom")).build()

    private fun status(payload: String) =
        json.parseToJsonElement(payload).jsonObject["status"]!!.jsonPrimitive.content

    private fun <T> collect(flow: Flow<T>): List<T> =
        runBlocking { withTimeout(5_000) { flow.toList() } }

    @Test
    fun `readable events come in order, the closed stream ends as Ended`() {
        server.enqueue(response("data: {\"status\":\"running\"}\n\ndata: {\"status\":\"done\"}\n\n"))

        val events = collect(sseStream(client, request()) { status(it) })

        assertEquals(
            listOf<SseEvent<String>>(SseEvent.Data("running"), SseEvent.Data("done"), SseEvent.Ended),
            events,
        )
    }

    @Test
    fun `an unreadable event ends the stream visibly`() {
        // The second event is no JSON; the third must no longer arrive.
        server.enqueue(response(
            "data: {\"status\":\"running\"}\n\ndata: das ist kein json\n\ndata: {\"status\":\"done\"}\n\n"))

        val events = collect(sseStream(client, request()) { status(it) })

        assertEquals(SseEvent.Data("running"), events[0])
        assertTrue("expected Unreadable, was ${events[1]}", events[1] is SseEvent.Unreadable)
        assertEquals("after the unreadable nothing more comes", 2, events.size)
    }

    @Test
    fun `an error response delivers code and body before the response is closed`() {
        server.enqueue(response("{\"error\":\"zu viele\",\"code\":\"too_many_connections\"}", code = 429))

        val events = collect(sseStream(client, request()) { status(it) })

        val error = events.single() as SseEvent.StreamFailed
        assertEquals(429, error.code)
        assertTrue("Body missing: ${error.body}", error.body!!.contains("too_many_connections"))
    }

    @Test
    fun `the CSV client reports an unreadable event as Failed`() {
        server.enqueue(response(
            "data: {\"success\":true,\"status\":\"running\",\"total\":3,\"done\":1}\n\ndata: [kaputt\n\n"))
        val events = collect(CsvImportSseClient(TestApi.redirected(server), json).stream())

        assertEquals(1, (events[0] as CsvImportSseClient.Event.Status).status.done)
        val error = events[1] as CsvImportSseClient.Event.Failed
        // The server's end would be „stream closed by server“; here it must be the payload.
        assertTrue("wrong reason: ${error.technical}", error.technical!!.startsWith("unreadable event"))
        assertEquals(2, events.size)
    }
}
