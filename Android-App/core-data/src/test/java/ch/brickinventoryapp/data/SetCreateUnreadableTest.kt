package ch.brickinventoryapp.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import ch.brickinventoryapp.testing.TestApi
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Creating a set via the stream: an unreadable event is an error. It could be the
 * completion event, and without completion the user never learns whether the set is there.
 *
 * Counter-check (patch gegenproben/anlegen-unlesbar-verschluckt.patch): verarbeite() silently returns
 * false again on an unreadable payload → red “an unreadable event
 * ends as an error” (the stream ends after the master data without completion).
 */
class SetCreateUnreadableTest {

    private val server = MockWebServer().apply { start() }

    @After
    fun zu() { server.shutdown() }

    @Test
    fun `an unreadable event ends as an error`() {
        server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream")
            .setBody("data: {\"step\":\"meta\",\"set\":\"Falke\"}\n\ndata: {kaputt\n\n"))
        val schritte = runBlocking {
            withTimeout(5_000) {
                SetCreateSseClient(TestApi.umgeleitet(server), Dispatchers.IO).anlegen("10305", 1, null, null, null, null).toList()
            }
        }

        assertEquals(SetCreateStep.Stammdaten("Falke"), schritte[0])
        assertTrue("erwartet Fehler, war ${schritte.last()}", schritte.last() is SetCreateStep.Fehler)
        assertEquals(2, schritte.size)
    }
}
