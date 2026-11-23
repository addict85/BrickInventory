package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.util.loadPdfIntoMemory
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
 * A voucher PDF is loaded entirely into memory, never into a file,
 * and only up to an upper limit. Executed against a test server.
 *
 * Counter-check: in loadPdfIntoMemory() the
 * check `content.size() + n > limit` removed → red “a response above the limit
 * is rejected …”; counter-checks/voucher-pdf-without-limit.patch
 */
class PdfInStorageTest {

    private val server = MockWebServer()
    private val client = OkHttpClient()

    @After
    fun tearDown() = server.shutdown()

    @Test
    fun `the PDF comes completely into memory, with progress`() {
        val pdf = ("%PDF-1.7 Gutschein 1234-5678 PIN 9999 " + "x".repeat(150_000)).toByteArray()
        server.enqueue(MockResponse().setBody(Buffer().write(pdf)))
        server.start()
        val state = mutableListOf<Pair<Long, Long>>()
        val loaded = runBlocking { loadPdfIntoMemory(client, server.url("/api/v2/vouchers/7/pdf").toString()) { g, t -> state += g to t } }
        assertArrayEquals(pdf, loaded)
        assertEquals(pdf.size.toLong() to pdf.size.toLong(), state.last())
    }

    @Test
    fun `a response above the limit is rejected, even without a length`() {
        server.enqueue(MockResponse().setBody(Buffer().write(ByteArray(2000))))
        server.enqueue(MockResponse().setChunkedBody(Buffer().write(ByteArray(2000)), 100))
        server.start()
        val address = server.url("/api/v2/vouchers/export/pdf").toString()
        val withLength = runCatching { runBlocking { loadPdfIntoMemory(client, address, limit = 1000) } }
        assertTrue("Content-Length above the limit", withLength.exceptionOrNull() is IOException)
        val withoutLength = runCatching { runBlocking { loadPdfIntoMemory(client, address, limit = 1000) } }
        assertTrue("A response without length above the limit is not loaded entirely", withoutLength.exceptionOrNull() is IOException)
    }

    @Test
    fun `an error status is not a PDF`() {
        server.enqueue(MockResponse().setResponseCode(403).setBody("verboten"))
        server.start()
        val r = runCatching { runBlocking { loadPdfIntoMemory(client, server.url("/api/v2/vouchers/7/pdf").toString()) } }
        assertTrue(r.exceptionOrNull() is IOException)
    }
}
