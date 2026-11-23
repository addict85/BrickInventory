package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.model.domain.SetRecorded
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
 * Counter-checks (patches under counter-checks/):
 *   create-json-shape-as-cancel   withoutStream() without the branch for 2xx → red “the JSON form …”
 *   create-rejection-without-sentence        errorTextFrom() always returns "" → red “a refusal carries …”
 *   create-rejected-as-cancel   sseStream never sets noConnection → red “without a server …”
 *   create-end-without-completion     Beendet without step → red “an end without done …”
 */
class SetCreateStreamTest {

    private val server = MockWebServer().apply { start() }

    @After
    fun tearDown() { runCatching { server.shutdown() } }

    private fun steps(): List<SetCreateStep> = runBlocking {
        withTimeout(5_000) {
            SetCreateSseClient(TestApi.redirected(server), Dispatchers.IO).create("10305", 1, null, null, null, null).toList()
        }
    }

    private fun stream(body: String) = MockResponse().setHeader("Content-Type", "text/event-stream").setBody(body)

    @Test
    fun `the JSON form is a finished creation, the existing set comes as a domain value`() {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json")
            .setBody("""{"success":true,"action":"exists","set_number":"10305-1"}"""))
        assertEquals(listOf(SetCreateStep.Done(SetRecorded(number = "10305-1", present = true))), steps())
    }

    @Test
    fun `a refusal carries the server's sentence`() {
        server.enqueue(MockResponse().setResponseCode(409).setHeader("Content-Type", "application/json")
            .setBody("""{"success":false,"error":"Set unbekannt"}"""))
        assertEquals(listOf(SetCreateStep.Failure("Set unbekannt")), steps())
    }

    @Test
    fun `a done with success false is an error with sentence, a done with success the completion`() {
        server.enqueue(stream("data: {\"step\":\"meta\",\"set\":\"Falke\"}\n\n" +
            "data: {\"step\":\"done\",\"success\":true,\"action\":\"added\",\"set_number\":\"10305-1\",\"supplement\":\"pending\"}\n\n"))
        server.enqueue(stream("data: {\"step\":\"done\",\"success\":false,\"error\":\"voll\"}\n\n"))
        assertEquals(listOf(SetCreateStep.MasterData("Falke"),
            SetCreateStep.Done(SetRecorded(number = "10305-1", created = true, supplementPending = true))), steps())
        assertEquals(listOf(SetCreateStep.Failure("voll")), steps())
    }

    @Test
    fun `an end without done is an abort, not a silent end`() {
        server.enqueue(stream("data: {\"step\":\"meta\",\"set\":\"Falke\"}\n\ndata: {\"step\":\"image\"}\n\n"))
        assertEquals(listOf(SetCreateStep.MasterData("Falke"), SetCreateStep.Image, SetCreateStep.Failure("")),
            steps())
    }

    @Test
    fun `without a server it is NoneConnection, so that the outbox may step in`() {
        val redirected = TestApi.redirected(server)
        server.shutdown()
        val s = runBlocking {
            withTimeout(5_000) {
                SetCreateSseClient(redirected, Dispatchers.IO).create("10305", 1, null, null, null, null).toList()
            }
        }
        assertEquals(listOf(SetCreateStep.NoConnection), s)
    }
}
