package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.PreviewMemory
import ch.brickinventoryapp.data.cache.PreviewPrewarmer
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
 * Prewarming the thumbnails, executed with a real store, a given
 * network state and a client that records every request: it fetches only what is missing,
 * marks its requests, stops at the 80 percent limit and on leaving the
 * allowed network after the running batch, and leaves air between the batches.
 *
 * Counter-checks (patches under counter-checks/):
 *   vorwaermen-holt-alles          filter on isPreview/hat removed → red “it fetches only …”
 *   vorwaermen-ohne-marke          the tag Vorwaermung removed → red “it fetches only …”
 *   vorwaermen-ueber-die-grenze    space per batch no longer asked → red “when the limit …”
 *   vorwaermen-netz-nur-anfangs    network state per batch no longer asked → red “when the device leaves …”
 *   vorwaermen-mobil-ungefragt     MOBILE without the permission → red “it starts only …”
 *   vorwaermen-ohne-pause          delay(PAUSE_MS) removed → red “between batches …”
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PreviewWarmerTest {

    private val root = File(System.getProperty("java.io.tmpdir"), "bim-vorwaermen-${System.nanoTime()}")
    private val memory = PreviewMemory({ root }, StoreCipher { ByteArray(32) { 9 } }) { ByteArray(32) { 19 } }
    private var situation = NetworkState.Kind.WIFI
    private val allowed = mutableMapOf(PrewarmNetwork.WIFI to true, PrewarmNetwork.MOBILE to false, PrewarmNetwork.ROAMING to false)
    private val posed: MutableList<Request> = Collections.synchronizedList(mutableListOf())
    /** Runs after every request; this way a test changes the state in the middle of the run. */
    private var afterRequest: () -> Unit = {}

    private val prefs = object : DevicesSettings {
        override val alarmMessagesEnabled: Flow<Boolean> = MutableStateFlow(false)
        override suspend fun setAlarmMessages(an: Boolean) = Unit
        override fun warmUpAllowed(network: PrewarmNetwork): Flow<Boolean> = flowOf(allowed.getValue(network))
        override suspend fun warmUpSet(network: PrewarmNetwork, allowed: Boolean) = Unit
    }

    private val client = OkHttpClient.Builder().addInterceptor { chain ->
        posed += chain.request()
        afterRequest()
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
            .body("bild".toResponseBody("image/jpeg".toMediaType())).build()
    }.build()

    private val prewarmer = PreviewPrewarmer(memory, NetworkState { situation }, prefs, client)

    @After
    fun tearDown() { root.deleteRecursively() }

    private fun preview(number: Int) = "https://brick.example/api/v1/images/set/$number-1?thumb=1"

    /** Fills the store up to the prewarming limit without writing the bytes. */
    private fun fillUntilToLimit() {
        if (!root.walkTopDown().any { it.isFile }) memory.write(preview(1), "x".toByteArray())
        val folder = root.walkTopDown().first { it.isFile }.parentFile!!
        RandomAccessFile(File(folder, "voll"), "rw").use { it.setLength(PreviewMemory.LIMIT_WARM_UP) }
    }

    @Test
    fun `it fetches only missing thumbnails, each once, reading and marked`() = runTest {
        memory.write(preview(2), "liegt schon".toByteArray())
        prewarmer.prewarm(listOf(preview(3), preview(3), preview(2),
            "https://brick.example/api/v1/images/set/4-1"))
        assertEquals(listOf(preview(3)), posed.map { it.url.toString() })
        val request = posed.single()
        assertEquals("GET", request.method)
        assertTrue("Die Anfrage trägt die Marke des Vorwärmers nicht", request.tag(WarmUp::class.java) != null)
        assertEquals("Die Marke reist als Kopfzeile zum Server", 0, request.headers.size)
    }

    @Test
    fun `when the limit is reached it stops after the running batch`() = runTest {
        afterRequest = { if (posed.size == 1) fillUntilToLimit() }
        prewarmer.prewarm((10..15).map(::preview))
        assertEquals("Ein Schub von zwei, dann ist Schluss", 2, posed.size)
    }

    @Test
    fun `when the device leaves the Wi-Fi it stops after the running batch`() = runTest {
        afterRequest = { situation = NetworkState.Kind.MOBILE }
        prewarmer.prewarm((10..15).map(::preview))
        assertEquals(2, posed.size)
    }

    @Test
    fun `it starts only on an allowed network and with space`() = runTest {
        val responses = NetworkState.Kind.entries.associateWith { situation = it; prewarmer.mayStart() }
        assertEquals("Vorgabe hier: nur WLAN", mapOf(NetworkState.Kind.NO_NETWORK to false, NetworkState.Kind.WIFI to true,
            NetworkState.Kind.MOBILE to false, NetworkState.Kind.ROAMING to false), responses)
        allowed[PrewarmNetwork.MOBILE] = true
        situation = NetworkState.Kind.MOBILE
        assertTrue("Mit Erlaubnis auch im Mobilfunk", prewarmer.mayStart())
        assertEquals("Vorgewärmt wird bis vier Fünftel der Ablage", 0.8,
            PreviewMemory.LIMIT_WARM_UP.toDouble() / PreviewMemory.MAX_BYTES, 1e-9)
        fillUntilToLimit()
        assertFalse("Bei voller Ablage startet nichts", prewarmer.mayStart())
    }

    /**
     * Every state asks its own permission. A new state is missing in the mapping and turns
     * the test red instead of silently falling under an existing answer.
     * Counter-check (patch vorwaermen-roaming-wie-mobil): ROAMING asks the permission of MOBILE → red here.
     */
    @Test
    fun `every network state follows its own permission`() = runTest {
        val assignment = mapOf(PrewarmNetwork.WIFI to NetworkState.Kind.WIFI, PrewarmNetwork.MOBILE to NetworkState.Kind.MOBILE,
            PrewarmNetwork.ROAMING to NetworkState.Kind.ROAMING)
        assertEquals("jede Erlaubnis hat ihre Lage", PrewarmNetwork.entries.toSet(), assignment.keys)
        for (network in PrewarmNetwork.entries) {
            PrewarmNetwork.entries.forEach { allowed[it] = it == network }
            val started = NetworkState.Kind.entries.filter { situation = it; prewarmer.mayStart() }
            assertEquals("nur $network erlaubt", listOf(assignment.getValue(network)), started)
        }
    }

    @Test
    fun `between batches there is a pause`() = runTest {
        prewarmer.prewarm((20..23).map(::preview))
        assertEquals(4, posed.size)
        assertTrue("Zwei Schübe ohne Pause ($currentTime ms)", currentTime >= 2 * 250)
    }
}
