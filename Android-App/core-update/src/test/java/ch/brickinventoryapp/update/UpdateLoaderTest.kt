package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.data.UpdateLoader
import ch.brickinventoryapp.model.util.AppVersion
import ch.brickinventoryapp.update.util.UPDATE_JSON_MAX_BYTES
import ch.brickinventoryapp.update.util.UPDATE_RELEASE_BASE
import ch.brickinventoryapp.update.util.UpdateBeschreibung
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
 * Counter-check (Nov 5, 2026, measured with kotlinc locally; gegenproben/update-abbruch-behaelt-teildatei.patch):
 *   `ziel.delete()` removed from the abort branch of UpdateLoader.loadApk → red
 *   „an aborted download leaves no partial file“.
 * Counter-checks (patches under gegenproben/, measured locally with kotlinc):
 *   update-apk-ohne-grenze      the check `geladen > obergrenze` removed → red
 *                               „ein APK, das mehr bringt als angekündigt …“
 *   update-json-unbegrenzt      body.string() instead of peekBody(UPDATE_JSON_MAX_BYTES) → red
 *                               „die Beschreibung wird höchstens …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UpdateLoaderTest {

    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-lader-${System.nanoTime()}").apply { mkdirs() }
    private val ziel = File(folder, "BrickInventory.apk")
    private val adresse = "$UPDATE_RELEASE_BASE/BrickInventory.apk"
    private val apk = ByteArray(640 * 1024) { (it % 251).toByte() }
    private val client = OkHttpClient.Builder().addInterceptor { kette ->
        Response.Builder().request(kette.request()).protocol(Protocol.HTTP_1_1).code(200).message("x")
            .body(apk.toResponseBody("application/octet-stream".toMediaType())).build()
    }.build()

    /** A client that delivers [bytes] as the response to every request. */
    private fun liefert(bytes: ByteArray) = OkHttpClient.Builder().addInterceptor { kette ->
        Response.Builder().request(kette.request()).protocol(Protocol.HTTP_1_1).code(200).message("x")
            .body(bytes.toResponseBody("application/octet-stream".toMediaType())).build()
    }.build()

    private fun beschreibung() = UpdateBeschreibung(versionCode = 20, versionName = "2.20", apkUrl = adresse, apkSize = apk.size.toLong())

    @After fun ab() { folder.deleteRecursively() }

    @Test
    fun `the progress rises to 100, and the file is complete`() = runTest {
        val lader = UpdateLoader(client, AppVersion("2.10", 10), StandardTestDispatcher(testScheduler))
        val schritte = lader.loadApk(beschreibung(), ziel).toList()
        assertEquals(100, schritte.last())
        assertTrue("Der Fortschritt steigt nur", schritte.zipWithNext().all { (a, b) -> b > a })
        assertEquals(apk.size.toLong(), ziel.length())
    }

    @Test
    fun `an aborted download leaves no partial file`() = runTest {
        val lader = UpdateLoader(client, AppVersion("2.10", 10), StandardTestDispatcher(testScheduler))
        // take(1) breaks off after the first update, in the middle of the read loop.
        assertEquals(1, lader.loadApk(beschreibung(), ziel).take(1).toList().size)
        assertFalse("Die Teildatei bleibt nach dem Abbruch liegen", ziel.exists())
    }

    @Test
    fun `an APK that brings more than announced aborts and leaves nothing`() = runTest {
        // Announced 100 kB; what's allowed is the announcement plus one MB, no more.
        val toMuch = ByteArray(2 * 1024 * 1024) { 7 }
        val lader = UpdateLoader(liefert(toMuch), AppVersion("2.10", 10), StandardTestDispatcher(testScheduler))
        val fehler = runCatching { lader.loadApk(beschreibung().copy(apkSize = 100L * 1024), ziel).toList() }.exceptionOrNull()
        assertTrue("Der Download lief über die Grenze hinaus durch ($fehler)", fehler is IOException)
        assertFalse("Das Zuviel bleibt auf der Platte", ziel.exists())
    }

    @Test
    fun `the description is read at most up to the upper limit`() = runTest {
        val huge = ByteArray(UPDATE_JSON_MAX_BYTES.toInt() * 4) { 'x'.code.toByte() }
        val lader = UpdateLoader(liefert(huge), AppVersion("2.10", 10), StandardTestDispatcher(testScheduler))
        assertEquals(UPDATE_JSON_MAX_BYTES, lader.fetchDescription().length.toLong())
    }
}
