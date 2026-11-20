package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.cache.VorschauVorwaermer
import ch.brickinventoryapp.data.cache.WarmUp
import ch.brickinventoryapp.security.StoreCipher
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.RandomAccessFile
import java.util.Collections

/**
 * Das Vorwärmen der Vorschaubilder, ausgeführt mit echter Ablage, einer vorgegebenen
 * Netzlage und einem Client, der jede Anfrage mitschreibt: Es holt nur, was fehlt,
 * markiert seine Anfragen, hört an der 80-Prozent-Grenze und beim Wechsel aus dem
 * erlaubten Netz nach dem laufenden Schub auf und lässt zwischen den Schüben Luft.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   vorwaermen-holt-alles          Filter auf isPreview/hat entfernt → rot „es holt nur …“
 *   vorwaermen-ohne-marke          das Tag Vorwaermung entfernt → rot „es holt nur …“
 *   vorwaermen-ueber-die-grenze    Platz je Schub nicht mehr gefragt → rot „ist die Grenze …“
 *   vorwaermen-netz-nur-anfangs    Netzlage je Schub nicht mehr gefragt → rot „verlässt das Gerät …“
 *   vorwaermen-mobil-ungefragt     MOBILE ohne die Erlaubnis → rot „gestartet wird nur …“
 *   vorwaermen-ohne-pause          delay(PAUSE_MS) entfernt → rot „zwischen den Schüben …“
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PreviewWarmerTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "bim-vorwaermen-${System.nanoTime()}")
    private val speicher = VorschauSpeicher({ root }, StoreCipher { ByteArray(32) { 9 } }) { ByteArray(32) { 19 } }
    private var situation = Netzlage.Art.WLAN
    private val erlaubt = mutableMapOf(VorwaermNetwork.WLAN to true, VorwaermNetwork.MOBILE to false, VorwaermNetwork.ROAMING to false)
    private val gestellt: MutableList<Request> = Collections.synchronizedList(mutableListOf())
    /** Läuft nach jeder Anfrage; so ändert ein Test die Lage mitten im Durchlauf. */
    private var afterRequest: () -> Unit = {}

    private val prefs = object : DevicesSettings {
        override val alarmMessagesAn: Flow<Boolean> = MutableStateFlow(false)
        override suspend fun setAlarmMessages(an: Boolean) = Unit
        override fun warmUpAllowed(netz: VorwaermNetwork): Flow<Boolean> = flowOf(erlaubt.getValue(netz))
        override suspend fun warmUpSet(netz: VorwaermNetwork, erlaubt: Boolean) = Unit
    }

    private val client = OkHttpClient.Builder().addInterceptor { kette ->
        gestellt += kette.request()
        afterRequest()
        Response.Builder().request(kette.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
            .body("bild".toResponseBody("image/jpeg".toMediaType())).build()
    }.build()

    private val vorwaermer = VorschauVorwaermer(speicher, Netzlage { situation }, prefs, client)

    @After
    fun zu() { root.deleteRecursively() }

    private fun vorschau(nummer: Int) = "https://brick.example/api/v1/images/set/$nummer-1?thumb=1"

    /** Füllt die Ablage bis an die Grenze des Vorwärmens, ohne die Bytes zu schreiben. */
    private fun fillUntilToLimit() {
        if (!root.walkTopDown().any { it.isFile }) speicher.schreibe(vorschau(1), "x".toByteArray())
        val folder = root.walkTopDown().first { it.isFile }.parentFile!!
        RandomAccessFile(File(folder, "voll"), "rw").use { it.setLength(VorschauSpeicher.LIMIT_WARM_UP) }
    }

    @Test
    fun `es holt nur fehlende Vorschaubilder, jedes einmal, lesend und markiert`() = runTest {
        speicher.schreibe(vorschau(2), "liegt schon".toByteArray())
        vorwaermer.vorwaermen(listOf(vorschau(3), vorschau(3), vorschau(2),
            "https://brick.example/api/v1/images/set/4-1"))
        assertEquals(listOf(vorschau(3)), gestellt.map { it.url.toString() })
        val anfrage = gestellt.single()
        assertEquals("GET", anfrage.method)
        assertTrue("Die Anfrage trägt die Marke des Vorwärmers nicht", anfrage.tag(WarmUp::class.java) != null)
        assertEquals("Die Marke reist als Kopfzeile zum Server", 0, anfrage.headers.size)
    }

    @Test
    fun `ist die Grenze erreicht, hoert es nach dem laufenden Schub auf`() = runTest {
        afterRequest = { if (gestellt.size == 1) fillUntilToLimit() }
        vorwaermer.vorwaermen((10..15).map(::vorschau))
        assertEquals("Ein Schub von zwei, dann ist Schluss", 2, gestellt.size)
    }

    @Test
    fun `verlaesst das Geraet das WLAN, hoert es nach dem laufenden Schub auf`() = runTest {
        afterRequest = { situation = Netzlage.Art.MOBILE }
        vorwaermer.vorwaermen((10..15).map(::vorschau))
        assertEquals(2, gestellt.size)
    }

    @Test
    fun `gestartet wird nur in einem erlaubten Netz und mit Platz`() = runTest {
        val antworten = Netzlage.Art.entries.associateWith { situation = it; vorwaermer.darfStarten() }
        assertEquals("Vorgabe hier: nur WLAN", mapOf(Netzlage.Art.KEIN_NETZ to false, Netzlage.Art.WLAN to true,
            Netzlage.Art.MOBILE to false, Netzlage.Art.ROAMING to false), antworten)
        erlaubt[VorwaermNetwork.MOBILE] = true
        situation = Netzlage.Art.MOBILE
        assertTrue("Mit Erlaubnis auch im Mobilfunk", vorwaermer.darfStarten())
        assertEquals("Vorgewärmt wird bis vier Fünftel der Ablage", 0.8,
            VorschauSpeicher.LIMIT_WARM_UP.toDouble() / VorschauSpeicher.MAX_BYTES, 1e-9)
        fillUntilToLimit()
        assertFalse("Bei voller Ablage startet nichts", vorwaermer.darfStarten())
    }

    /**
     * Jede Lage fragt ihre eigene Erlaubnis. Eine neue Lage fehlt in der Zuordnung und macht
     * den Test rot, statt still unter eine bestehende Antwort zu fallen.
     * Gegenprobe (Patch vorwaermen-roaming-wie-mobil): ROAMING fragt die Erlaubnis von MOBILE → rot hier.
     */
    @Test
    fun `jede Netzlage folgt ihrer eigenen Erlaubnis`() = runTest {
        val zuordnung = mapOf(VorwaermNetwork.WLAN to Netzlage.Art.WLAN, VorwaermNetwork.MOBILE to Netzlage.Art.MOBILE,
            VorwaermNetwork.ROAMING to Netzlage.Art.ROAMING)
        assertEquals("jede Erlaubnis hat ihre Lage", VorwaermNetwork.entries.toSet(), zuordnung.keys)
        for (netz in VorwaermNetwork.entries) {
            VorwaermNetwork.entries.forEach { erlaubt[it] = it == netz }
            val gestartet = Netzlage.Art.entries.filter { situation = it; vorwaermer.darfStarten() }
            assertEquals("nur $netz erlaubt", listOf(zuordnung.getValue(netz)), gestartet)
        }
    }

    @Test
    fun `zwischen den Schueben wird pausiert`() = runTest {
        vorwaermer.vorwaermen((20..23).map(::vorschau))
        assertEquals(4, gestellt.size)
        assertTrue("Zwei Schübe ohne Pause ($currentTime ms)", currentTime >= 2 * 250)
    }
}
