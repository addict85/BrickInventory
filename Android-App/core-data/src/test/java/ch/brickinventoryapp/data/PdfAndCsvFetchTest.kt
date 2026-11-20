package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetDateienRepository
import ch.brickinventoryapp.model.fach.Teilelistenauftrag
import ch.brickinventoryapp.model.fach.Laufstatus
import ch.brickinventoryapp.testing.testSetFilesRepository
import ch.brickinventoryapp.testing.TestApi
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * PDF-Auftrag und CSV-Status laufen wie jeder Abruf durch sicherAufrufen: Ein
 * Netzfehler ist vorübergehend, ein 401 eine Abweisung, und keiner trägt Token oder
 * Adresse selbst — die setzt der Wächter (hier ersetzt durch den Testserver).
 *
 * Gegenprobe (gegenproben/pdf-ohne-sicheraufrufen.patch, nur in der CI messbar):
 *   startPdfJob fängt Ausnahmen wieder selbst und macht daraus Unbekannt → rot
 *   „ein Netzfehler ist vorübergehend …“
 */
class PdfAndCsvFetchTest {

    private val server = MockWebServer().apply { start() }
    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-pdf-${System.nanoTime()}").apply { mkdirs() }
    private val sets: SetDateienRepository = testSetFilesRepository(TestApi.fuer(server))

    @After
    fun zu() {
        runCatching { server.shutdown() }
        folder.deleteRecursively()
    }

    private fun teardown() = MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START)
    private fun abgewiesen() = TestApi.antwort("""{"success":false,"error":"Token abgelaufen"}""", code = 401)

    private fun <T> fehler(r: Ergebnis<T>): Ergebnis.Fehler {
        assertTrue("erwartet ein Fehler, war $r", r is Ergebnis.Fehler)
        return r as Ergebnis.Fehler
    }

    @Test
    fun `ein Netzfehler ist vorübergehend, für jeden Abruf von Auftrag und Status`() = runBlocking {
        repeat(4) { server.enqueue(teardown()) }
        val alle = listOf(sets.startPdfJob(Teilelistenauftrag(emptyList(), emptyList())), sets.getPdfJobStatus("j1"), sets.downloadPdf("j1"), sets.getCsvImportStatus())
        for (r in alle) {
            val f = fehler(r)
            assertTrue("$f ist nicht vorübergehend", f.transient)
        }
    }

    @Test
    fun `ein 401 ist eine Abweisung mit dem Satz des Servers`() = runBlocking {
        repeat(4) { server.enqueue(abgewiesen()) }
        val alle = listOf(sets.startPdfJob(Teilelistenauftrag(emptyList(), emptyList())), sets.getPdfJobStatus("j1"), sets.downloadPdf("j1"), sets.getCsvImportStatus())
        for (r in alle) {
            val f = fehler(r)
            assertTrue("$f ist keine Abweisung", f is Ergebnis.Fehler.Abgewiesen)
            assertEquals("Token abgelaufen", f.message)
        }
    }

    @Test
    fun `der Stand eines Auftrags kommt als Fachwert, die Nummer aus dem Modell`() = runBlocking {
        server.enqueue(TestApi.antwort("""{"success":true,"jobId":"j7"}"""))
        server.enqueue(TestApi.antwort("""{"success":true,"status":"running","etaSeconds":12,"missingImages":3}"""))
        server.enqueue(TestApi.antwort("""{"success":true,"jobId":""}"""))

        assertEquals(Ergebnis.Erfolg("j7"), sets.startPdfJob(Teilelistenauftrag(emptyList(), emptyList())))
        val stand = (sets.getPdfJobStatus("j7") as Ergebnis.Erfolg).data
        assertEquals(Laufstatus.LAEUFT, stand.status)
        assertEquals(12.0, stand.restSeconds)
        assertNull(stand.fehler)
        assertTrue("ohne Nummer kein Auftrag", sets.startPdfJob(Teilelistenauftrag(emptyList(), emptyList())) is Ergebnis.Fehler.LeereAntwort)

        val paths = List(3) { server.takeRequest().path }
        assertEquals(listOf("/api/v1/sets/partslist-pdf", "/api/v1/sets/partslist-pdf/status/j7", "/api/v1/sets/partslist-pdf"), paths)
    }
}
