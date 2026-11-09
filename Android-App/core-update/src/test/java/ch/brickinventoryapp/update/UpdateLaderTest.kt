package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.data.UpdateLader
import ch.brickinventoryapp.model.util.AppFassung
import ch.brickinventoryapp.update.util.UPDATE_JSON_MAX_BYTES
import ch.brickinventoryapp.update.util.UPDATE_RELEASE_BASIS
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
 * Der APK-Download der Datenschicht: Fortschritt als Fluss, ein Abbruch lässt keine
 * Teildatei zurück, und beide Abrufe haben eine Obergrenze. Ein Client ohne Netz
 * liefert die Bytes.
 *
 * Gegenprobe (05.11.2026, gemessen mit kotlinc lokal; gegenproben/update-abbruch-behaelt-teildatei.patch):
 *   im Abbruch-Zweig von UpdateLader.ladeApk `ziel.delete()` entfernt → rot
 *   „ein abgebrochener Download hinterlässt keine Teildatei“.
 * Gegenproben (Patches unter gegenproben/, lokal mit kotlinc gemessen):
 *   update-apk-ohne-grenze      die Prüfung `geladen > obergrenze` entfernt → rot
 *                               „ein APK, das mehr bringt als angekündigt …“
 *   update-json-unbegrenzt      body.string() statt peekBody(UPDATE_JSON_MAX_BYTES) → rot
 *                               „die Beschreibung wird höchstens …“
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

    /** Ein Client, der [bytes] als Antwort auf jede Anfrage liefert. */
    private fun liefert(bytes: ByteArray) = OkHttpClient.Builder().addInterceptor { kette ->
        Response.Builder().request(kette.request()).protocol(Protocol.HTTP_1_1).code(200).message("x")
            .body(bytes.toResponseBody("application/octet-stream".toMediaType())).build()
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

    @Test
    fun `ein APK, das mehr bringt als angekuendigt, bricht ab und hinterlaesst nichts`() = runTest {
        // Angekündigt 100 kB; erlaubt sind die Ankündigung und ein MB, nicht mehr.
        val zuViel = ByteArray(2 * 1024 * 1024) { 7 }
        val lader = UpdateLader(liefert(zuViel), AppFassung("2.10", 10), StandardTestDispatcher(testScheduler))
        val fehler = runCatching { lader.ladeApk(beschreibung().copy(apkSize = 100L * 1024), ziel).toList() }.exceptionOrNull()
        assertTrue("Der Download lief über die Grenze hinaus durch ($fehler)", fehler is IOException)
        assertFalse("Das Zuviel bleibt auf der Platte", ziel.exists())
    }

    @Test
    fun `die Beschreibung wird hoechstens bis zur Obergrenze gelesen`() = runTest {
        val riesig = ByteArray(UPDATE_JSON_MAX_BYTES.toInt() * 4) { 'x'.code.toByte() }
        val lader = UpdateLader(liefert(riesig), AppFassung("2.10", 10), StandardTestDispatcher(testScheduler))
        assertEquals(UPDATE_JSON_MAX_BYTES, lader.holeBeschreibung().length.toLong())
    }
}
