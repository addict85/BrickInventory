package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetDateienRepository
import ch.brickinventoryapp.model.data.model.PdfAuftragAnfrage
import ch.brickinventoryapp.model.fach.Laufstatus
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.testing.SetDateienRepository
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
class PdfUndCsvAbrufTest {

    private val server = MockWebServer().apply { start() }
    private val ordner = File(System.getProperty("java.io.tmpdir"), "bim-pdf-${System.nanoTime()}").apply { mkdirs() }
    private val sets: SetDateienRepository = SetDateienRepository(TestApi.fuer(server), ResponseCache { ordner })

    @After
    fun zu() {
        runCatching { server.shutdown() }
        ordner.deleteRecursively()
    }

    private fun abriss() = MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START)
    private fun abgewiesen() = TestApi.antwort("""{"success":false,"error":"Token abgelaufen"}""", code = 401)

    private fun <T> fehler(r: Ergebnis<T>): Ergebnis.Error {
        assertTrue("erwartet ein Fehler, war $r", r is Ergebnis.Error)
        return r as Ergebnis.Error
    }

    @Test
    fun `ein Netzfehler ist vorübergehend, für jeden Abruf von Auftrag und Status`() = runBlocking {
        repeat(4) { server.enqueue(abriss()) }
        val alle = listOf(sets.startPdfJob(PdfAuftragAnfrage()), sets.getPdfJobStatus("j1"), sets.downloadPdf("j1"), sets.getCsvImportStatus())
        for (r in alle) {
            val f = fehler(r)
            assertTrue("$f ist nicht vorübergehend", f.transient)
        }
    }

    @Test
    fun `ein 401 ist eine Abweisung mit dem Satz des Servers`() = runBlocking {
        repeat(4) { server.enqueue(abgewiesen()) }
        val alle = listOf(sets.startPdfJob(PdfAuftragAnfrage()), sets.getPdfJobStatus("j1"), sets.downloadPdf("j1"), sets.getCsvImportStatus())
        for (r in alle) {
            val f = fehler(r)
            assertTrue("$f ist keine Abweisung", f is Ergebnis.Error.Abgewiesen)
            assertEquals("Token abgelaufen", f.message)
        }
    }

    @Test
    fun `der Stand eines Auftrags kommt als Fachwert, die Nummer aus dem Modell`() = runBlocking {
        server.enqueue(TestApi.antwort("""{"success":true,"jobId":"j7"}"""))
        server.enqueue(TestApi.antwort("""{"success":true,"status":"running","etaSeconds":12,"missingImages":3}"""))
        server.enqueue(TestApi.antwort("""{"success":true,"jobId":""}"""))

        assertEquals(Ergebnis.Success("j7"), sets.startPdfJob(PdfAuftragAnfrage()))
        val stand = (sets.getPdfJobStatus("j7") as Ergebnis.Success).data
        assertEquals(Laufstatus.LAEUFT, stand.status)
        assertEquals(12.0, stand.etaSeconds)
        assertNull(stand.error)
        assertTrue("ohne Nummer kein Auftrag", sets.startPdfJob(PdfAuftragAnfrage()) is Ergebnis.Error.LeereAntwort)

        val pfade = List(3) { server.takeRequest().path }
        assertEquals(listOf("/api/v1/sets/partslist-pdf", "/api/v1/sets/partslist-pdf/status/j7", "/api/v1/sets/partslist-pdf"), pfade)
    }
}
