package ch.brickinventoryapp.data

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.util.InstructionStore
import ch.brickinventoryapp.dataapi.instructions.pdfStore
import ch.brickinventoryapp.security.StoreCipher
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
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.util.Collections

/**
 * The download of a building instruction against a test server that breaks off in the middle of the
 * body on the first fetch: loading goes into the partial file, resumed at the plaintext byte via Range,
 * only afterwards does the file get the finished one's name. The fetch goes via the api client, thus
 * with its headers (token). Under Robolectric (context, Wi-Fi lock), in ticks.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   instruction-straight-to-target   the download writes directly into the finished file → red
 *                               “a broken download …” (the rest counts as finished)
 *   instruction-without-range        the Range header is missing when resuming → red, the same test
 *   instruction-own-client    an own OkHttpClient instead of the api client → red, the same test
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class InstructionDownloadTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()
    private val pdf = ByteArray(400_000) { (it % 241).toByte() }
    private val posed: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())
    private val server = MockWebServer().apply {
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                posed += request
                val ab = request.getHeader("Range")?.removePrefix("bytes=")?.removeSuffix("-")?.toIntOrNull()
                return when {
                    posed.size == 1 -> MockResponse().setBody(Buffer().write(pdf))
                        .setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY)
                    ab != null -> MockResponse().setResponseCode(206)
                        .setHeader("Content-Range", "bytes $ab-${pdf.size - 1}/${pdf.size}")
                        .setBody(Buffer().write(pdf.copyOfRange(ab, pdf.size)))
                    else -> MockResponse().setBody(Buffer().write(pdf.copyOf(1000)))
                }
            }
        }
        start()
    }

    @After
    fun tearDown() { server.shutdown() }

    @Test
    fun `a broken download is resumed at the partial file and renamed only at the end`() = runTest {
        val store = InstructionStore(StoreCipher { ByteArray(32) { 6 } })
        val api = OkHttpClient.Builder().addInterceptor { chain ->
            chain.proceed(chain.request().newBuilder().header("Authorization", "Bearer token-marco").build())
        }.build()
        val address = server.url("/api/v2/instructions/42/file").toString()
        val target = pdfStore(ctx.cacheDir, address, false)!!
        val download = InstructionDownload(ctx, api, store, StandardTestDispatcher(testScheduler))

        download.load(address, target, once = false) { _, _ -> }

        assertEquals("Broken off and resumed once", 2, posed.size)
        val range = posed[1].getHeader("Range")
        assertTrue("Resumed at the plaintext byte, not from the start: $range",
            range != null && range != "bytes=0-" && range.startsWith("bytes="))
        assertArrayEquals("The finished file carries the whole instruction", pdf, store.read(target).use { it.readBytes() })
        assertFalse("The partial file stays behind", File(target.path + ".part").exists())
        assertTrue("Without the api client's headers", posed.all { it.getHeader("Authorization") == "Bearer token-marco" })
    }
}
