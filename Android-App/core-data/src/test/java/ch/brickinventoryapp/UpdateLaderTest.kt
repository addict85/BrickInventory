package ch.brickinventoryapp

import ch.brickinventoryapp.data.UpdateLader
import ch.brickinventoryapp.util.AppFassung
import ch.brickinventoryapp.util.UPDATE_RELEASE_BASIS
import ch.brickinventoryapp.util.UpdateBeschreibung
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

/**
 * Der APK-Download der Datenschicht: Fortschritt als Fluss, und ein Abbruch lässt
 * keine Teildatei zurück. Ein Client ohne Netz liefert die Bytes.
 *
 * Gegenprobe (05.11.2026, gemessen mit kotlinc lokal; gegenproben/update-abbruch-behaelt-teildatei.patch):
 *   im Abbruch-Zweig von UpdateLader.ladeApk `ziel.delete()` entfernt → rot
 *   „ein abgebrochener Download hinterlässt keine Teildatei“.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UpdateLaderTest {

    private val ordner = File(System.getProperty("java.io.tmpdir"), "bim-lader-${System.nanoTime()}").apply { mkdirs() }
    private val ziel = File(ordner, "BrickInventory.apk")
    private val adresse = "$UPDATE_RELEASE_BASIS/BrickInventory.apk"
    private val apk = ByteArray(640 * 1024) { (it % 251).toByte() }
    private val client = OkHttpClient.Builder().addInterceptor { kette ->
        Response.Builder().request(kette.request()).protocol(Protocol.HTTP_1_1).code(200).message("x")
            .body(apk.toResponseBody("application/octet-stream".toMediaType())).build()
    }.build()

    private fun beschreibung() = UpdateBeschreibung(versionCode = 20, versionName = "2.20", apkUrl = adresse, apkSize = apk.size.toLong())

    @After fun ab() { ordner.deleteRecursively() }

    @Test
    fun `der Fortschritt steigt bis 100, und die Datei ist vollstaendig`() = runTest {
        val lader = UpdateLader(client, AppFassung("2.10", 10), StandardTestDispatcher(testScheduler))
        val schritte = lader.ladeApk(beschreibung(), ziel).toList()
        assertEquals(100, schritte.last())
        assertTrue("Der Fortschritt steigt nur", schritte.zipWithNext().all { (a, b) -> b > a })
        assertEquals(apk.size.toLong(), ziel.length())
    }

    @Test
    fun `ein abgebrochener Download hinterlässt keine Teildatei`() = runTest {
        val lader = UpdateLader(client, AppFassung("2.10", 10), StandardTestDispatcher(testScheduler))
        // take(1) bricht nach der ersten Meldung ab, mitten in der Leseschleife.
        assertEquals(1, lader.ladeApk(beschreibung(), ziel).take(1).toList().size)
        assertFalse("Die Teildatei bleibt nach dem Abbruch liegen", ziel.exists())
    }
}
