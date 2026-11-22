package ch.brickinventoryapp.update

import ch.brickinventoryapp.model.util.AppVersion
import ch.brickinventoryapp.update.data.UpdateLoader
import ch.brickinventoryapp.update.util.UPDATE_JSON_MAX_BYTES
import ch.brickinventoryapp.update.util.UPDATE_RELEASE_BASE
import ch.brickinventoryapp.update.util.UpdateDescription
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException

/**
 * The data layer's APK download: progress as a flow, an abort leaves no
 * partial file behind, and both fetches have an upper bound. A client without network
 * delivers the bytes.
 *
 * Counter-check (Nov 5, 2026, measured with kotlinc locally; counter-checks/update-abbruch-behaelt-teildatei.patch):
 *   `target.delete()` removed from the abort branch of UpdateLoader.loadApk → red
 *   „an aborted download leaves no partial file“.
 * Counter-checks (patches under counter-checks/, measured locally with kotlinc):
 *   update-apk-ohne-grenze      the check `loaded > upperLimit` removed → red
 *                               „ein APK, das mehr bringt als angekündigt …“
 *   update-json-unbegrenzt      body.string() instead of peekBody(UPDATE_JSON_MAX_BYTES) → red
 *                               „die Beschreibung wird höchstens …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UpdateLoaderTest {

    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-lader-${System.nanoTime()}").apply { mkdirs() }
    private val target = File(folder, "BrickInventory.apk")
    private val address = "$UPDATE_RELEASE_BASE/BrickInventory.apk"
    private val apk = ByteArray(640 * 1024) { (it % 251).toByte() }
    private val client = OkHttpClient.Builder().addInterceptor { chain ->
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("x")
            .body(apk.toResponseBody("application/octet-stream".toMediaType())).build()
    }.build()

    /** A client that delivers [bytes] as the response to every request. */
    private fun delivers(bytes: ByteArray) = OkHttpClient.Builder().addInterceptor { chain ->
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("x")
            .body(bytes.toResponseBody("application/octet-stream".toMediaType())).build()
    }.build()

    private fun description() = UpdateDescription(versionCode = 20, versionName = "2.20", apkUrl = address, apkSize = apk.size.toLong())

    @After fun ab() { folder.deleteRecursively() }

    @Test
    fun `the progress rises to 100, and the file is complete`() = runTest {
        val loader = UpdateLoader(client, AppVersion("2.10", 10), StandardTestDispatcher(testScheduler))
        val steps = loader.loadApk(description(), target).toList()
        assertEquals(100, steps.last())
        assertTrue("the progress only rises", steps.zipWithNext().all { (a, b) -> b > a })
        assertEquals(apk.size.toLong(), target.length())
    }

    @Test
    fun `an aborted download leaves no partial file`() = runTest {
        val loader = UpdateLoader(client, AppVersion("2.10", 10), StandardTestDispatcher(testScheduler))
        // take(1) breaks off after the first update, in the middle of the read loop.
        assertEquals(1, loader.loadApk(description(), target).take(1).toList().size)
        assertFalse("the partial file stays after the cancellation", target.exists())
    }

    @Test
    fun `an APK that brings more than announced aborts and leaves nothing`() = runTest {
        // Announced 100 kB; what's allowed is the announcement plus one MB, no more.
        val toMuch = ByteArray(2 * 1024 * 1024) { 7 }
        val loader = UpdateLoader(delivers(toMuch), AppVersion("2.10", 10), StandardTestDispatcher(testScheduler))
        val error = runCatching { loader.loadApk(description().copy(apkSize = 100L * 1024), target).toList() }.exceptionOrNull()
        assertTrue("the download ran past the limit ($error)", error is IOException)
        assertFalse("the excess stays on disk", target.exists())
    }

    @Test
    fun `the description is read at most up to the upper limit`() = runTest {
        val huge = ByteArray(UPDATE_JSON_MAX_BYTES.toInt() * 4) { 'x'.code.toByte() }
        val loader = UpdateLoader(delivers(huge), AppVersion("2.10", 10), StandardTestDispatcher(testScheduler))
        assertEquals(UPDATE_JSON_MAX_BYTES, loader.fetchDescription().length.toLong())
    }
}
