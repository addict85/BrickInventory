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
 * Set anlegen über den Strom: Ein unlesbares Ereignis ist ein Fehler. Es könnte das
 * Abschlussereignis sein, und ohne Abschluss erfährt der Nutzer nie, ob das Set da ist.
 *
 * Gegenprobe (Patch gegenproben/anlegen-unlesbar-verschluckt.patch): verarbeite() gibt bei
 * einer unlesbaren Nutzlast wieder still false zurück → rot „ein unlesbares Ereignis
 * endet als Fehler“ (der Strom endet nach den Stammdaten ohne Abschluss).
 */
class SetAnlegenUnlesbarTest {

    private val server = MockWebServer().apply { start() }

    @After
    fun zu() { server.shutdown() }

    @Test
    fun `ein unlesbares Ereignis endet als Fehler`() {
        server.enqueue(MockResponse().setHeader("Content-Type", "text/event-stream")
            .setBody("data: {\"step\":\"meta\",\"set\":\"Falke\"}\n\ndata: {kaputt\n\n"))
        val schritte = runBlocking {
            withTimeout(5_000) {
                SetAnlegenSseClient(TestApi.umgeleitet(server), Dispatchers.IO).anlegen("10305", 1, null, null, null, null).toList()
            }
        }

        assertEquals(SetAnlegenSchritt.Stammdaten("Falke"), schritte[0])
        assertTrue("erwartet Fehler, war ${schritte.last()}", schritte.last() is SetAnlegenSchritt.Fehler)
        assertEquals(2, schritte.size)
    }
}
