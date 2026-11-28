package ch.brickinventoryapp.data

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.util.InstructionStore
import ch.brickinventoryapp.data.util.pdfStore
import ch.brickinventoryapp.security.StoreCipher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.util.Collections

/**
 * The instruction download against a test server that sends too much or resumes at the wrong
 * byte: over the limit it aborts without a retry and leaves no partial file; a 206 from another
 * offset is not spliced in, the download starts again at 0. Under Robolectric, in ticks.
 *
 * Counter-checks (patches under counter-checks/, measured with tools/counter-checks.py):
 *   instruction-without-size-limit       the check of the bytes written removed → red “a body over
 *                                        the limit …”
 *   instruction-announced-size-unchecked the check of the announced total removed → red “a resume
 *                                        announcing a total over the limit …”
 *   instruction-range-start-unchecked    the Content-Range start not compared → red “a 206 from
 *                                        another offset …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
class InstructionLimitTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()
    private val pdf = ByteArray(400_000) { (it % 241).toByte() }
    private val posed: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())
    private var answer: (RecordedRequest, Int?) -> MockResponse = { _, _ -> MockResponse().setResponseCode(500) }
    private val server = MockWebServer().apply {
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                posed += request
                val ab = request.getHeader("Range")?.removePrefix("bytes=")?.removeSuffix("-")?.toIntOrNull()
                return answer(request, ab)
            }
        }
        start()
    }
    private val store = InstructionStore(StoreCipher { ByteArray(32) { 6 } })
    private val address = server.url("/api/v2/instructions/42/file").toString()
    private val target = pdfStore(ctx.cacheDir, address, false)!!
    private val part = File(target.path + ".part")

    @After
    fun tearDown() { server.shutdown() }

    /** The first fetch breaks off in the body, as in InstructionDownloadTest. */
    private fun brokenOff() = MockResponse().setBody(Buffer().write(pdf))
        .setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY)

    private fun rest(ab: Int, total: Int = pdf.size) = MockResponse().setResponseCode(206)
        .setHeader("Content-Range", "bytes $ab-${pdf.size - 1}/$total")
        .setBody(Buffer().write(pdf.copyOfRange(ab, pdf.size)))

    private suspend fun load(limit: Long, dispatcher: CoroutineDispatcher): Throwable? = runCatching {
        InstructionDownload(ctx, OkHttpClient(), store, dispatcher, limit).load(address, target, once = false) { _, _ -> }
    }.exceptionOrNull()

    @Test
    fun `a body over the limit without an announced length aborts at once and leaves no partial file`() = runTest {
        answer = { _, _ -> MockResponse().setChunkedBody(Buffer().write(pdf), 64 * 1024) }
        val error = load(limit = 100_000, StandardTestDispatcher(testScheduler))
        assertTrue("expected DownloadFailed, got $error", error is DownloadFailed)
        assertEquals("no retry for a file that is too large", 1, posed.size)
        assertFalse("the partial file stays behind", part.exists())
        assertFalse(target.exists())
    }

    @Test
    fun `a resume announcing a total over the limit aborts and deletes the partial file`() = runTest {
        answer = { _, ab -> if (ab == null) brokenOff() else rest(ab, total = 5_000_000) }
        val error = load(limit = 1_000_000, StandardTestDispatcher(testScheduler))
        assertTrue("expected DownloadFailed, got $error", error is DownloadFailed)
        assertEquals("broken off, then the resume that announces too much", 2, posed.size)
        assertFalse("the partial file stays behind", part.exists())
        assertFalse(target.exists())
    }

    @Test
    fun `a 206 from another offset is not spliced in, the download starts again at 0`() = runTest {
        answer = { _, ab ->
            when {
                posed.size == 1 -> brokenOff()
                // Answers a resume with the file from the start: these bytes do not belong at the offset.
                ab != null -> rest(0)
                else -> MockResponse().setBody(Buffer().write(pdf))
            }
        }
        val error = load(limit = 1_000_000, StandardTestDispatcher(testScheduler))
        assertNull(error)
        assertEquals(3, posed.size)
        assertTrue("the first resume asks for a later byte", posed[1].getHeader("Range")?.startsWith("bytes=") == true)
        assertNull("after the wrong 206 the fetch starts at 0, without Range", posed[2].getHeader("Range"))
        assertArrayEquals("the finished file carries exactly the instruction", pdf, store.read(target).use { it.readBytes() })
    }
}
