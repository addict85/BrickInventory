package ch.brickinventoryapp

import ch.brickinventoryapp.util.ladePdfInDenSpeicher
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Ein Gutschein-PDF wird ganz in den Speicher geladen, nie in eine Datei (sec11 N1),
 * und nur bis zu einer Obergrenze. Ausgeführt gegen einen Testserver.
 *
 * Gegenprobe (04.11.2026, gemessen mit kotlinc lokal): in ladePdfInDenSpeicher() die
 * Prüfung `inhalt.size() + n > grenze` entfernt → rot „eine Antwort ohne Laenge
 * ueber der Grenze …“; gegenproben/gutschein-pdf-ohne-grenze.patch
 */
class PdfImSpeicherTest {

    private val server = MockWebServer()
    private val client = OkHttpClient()

    @After
    fun zu() = server.shutdown()

    @Test
    fun `das PDF kommt vollstaendig in den Speicher, mit Fortschritt`() {
        val pdf = ("%PDF-1.7 Gutschein 1234-5678 PIN 9999 " + "x".repeat(150_000)).toByteArray()
        server.enqueue(MockResponse().setBody(Buffer().write(pdf)))
        server.start()
        val stand = mutableListOf<Pair<Long, Long>>()
        val geladen = runBlocking { ladePdfInDenSpeicher(client, server.url("/api/v1/vouchers/7/pdf").toString()) { g, t -> stand += g to t } }
        assertArrayEquals(pdf, geladen)
        assertEquals(pdf.size.toLong() to pdf.size.toLong(), stand.last())
    }

    @Test
    fun `eine Antwort ueber der Grenze wird abgelehnt, auch ohne Laengenangabe`() {
        server.enqueue(MockResponse().setBody(Buffer().write(ByteArray(2000))))
        server.enqueue(MockResponse().setChunkedBody(Buffer().write(ByteArray(2000)), 100))
        server.start()
        val adresse = server.url("/api/v1/vouchers/export/pdf").toString()
        val mitLaenge = runCatching { runBlocking { ladePdfInDenSpeicher(client, adresse, grenze = 1000) } }
        assertTrue("Content-Length über der Grenze", mitLaenge.exceptionOrNull() is IOException)
        val ohneLaenge = runCatching { runBlocking { ladePdfInDenSpeicher(client, adresse, grenze = 1000) } }
        assertTrue("Eine Antwort ohne Laenge ueber der Grenze wird nicht ganz geladen", ohneLaenge.exceptionOrNull() is IOException)
    }

    @Test
    fun `ein Fehlerstatus ist kein PDF`() {
        server.enqueue(MockResponse().setResponseCode(403).setBody("verboten"))
        server.start()
        val r = runCatching { runBlocking { ladePdfInDenSpeicher(client, server.url("/api/v1/vouchers/7/pdf").toString()) } }
        assertTrue(r.exceptionOrNull() is IOException)
    }
}
