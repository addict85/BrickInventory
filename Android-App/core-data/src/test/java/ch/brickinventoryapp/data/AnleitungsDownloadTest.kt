package ch.brickinventoryapp.data

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.data.util.InstructionStore
import ch.brickinventoryapp.data.util.pdfAblage
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
 * Counter-checks (patches under gegenproben/, Robolectric, measured by CI):
 *   anleitung-direkt-ins-ziel   the download writes directly into the finished file → red
 *                               “a broken download …” (the rest counts as finished)
 *   anleitung-ohne-range        the Range header is missing when resuming → red, the same test
 *   anleitung-eigener-client    an own OkHttpClient instead of the api client → red, the same test
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AnleitungsDownloadTest {

    private val ctx = ApplicationProvider.getApplicationContext<Application>()
    private val pdf = ByteArray(400_000) { (it % 241).toByte() }
    private val gestellt: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())
    private val server = MockWebServer().apply {
        dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                gestellt += request
                val ab = request.getHeader("Range")?.removePrefix("bytes=")?.removeSuffix("-")?.toIntOrNull()
                return when {
                    gestellt.size == 1 -> MockResponse().setBody(Buffer().write(pdf))
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
    fun zu() { server.shutdown() }

    @Test
    fun `a broken download is resumed at the partial file and renamed only at the end`() = runTest {
        val ablage = InstructionStore(StoreCipher { ByteArray(32) { 6 } })
        val api = OkHttpClient.Builder().addInterceptor { kette ->
            kette.proceed(kette.request().newBuilder().header("Authorization", "Bearer token-marco").build())
        }.build()
        val adresse = server.url("/api/v1/instructions/42/file").toString()
        val ziel = pdfAblage(ctx.cacheDir, adresse, false)!!
        val download = AnleitungsDownload(ctx, api, ablage, StandardTestDispatcher(testScheduler))

        download.lade(adresse, ziel, einmalig = false) { _, _ -> }

        assertEquals("Abgerissen und einmal fortgesetzt", 2, gestellt.size)
        val range = gestellt[1].getHeader("Range")
        assertTrue("Fortgesetzt wird am Klartext-Byte, nicht von vorn: $range",
            range != null && range != "bytes=0-" && range.startsWith("bytes="))
        assertArrayEquals("Die fertige Datei trägt die ganze Anleitung", pdf, ablage.lies(ziel).use { it.readBytes() })
        assertFalse("Die Teildatei bleibt liegen", File(ziel.path + ".part").exists())
        assertTrue("Ohne die Köpfe des api-Clients", gestellt.all { it.getHeader("Authorization") == "Bearer token-marco" })
    }
}
