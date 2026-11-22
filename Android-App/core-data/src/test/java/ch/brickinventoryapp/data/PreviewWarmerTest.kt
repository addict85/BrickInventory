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
 *   prewarm-fetches-everything          filter on isPreview/hat removed → red “it fetches only …”
 *   prewarm-without-marker          the tag Vorwaermung removed → red “it fetches only …”
 *   prewarm-beyond-the-limit    space per batch no longer asked → red “when the limit …”
 *   prewarm-network-only-at-start    network state per batch no longer asked → red “when the device leaves …”
 *   prewarm-mobile-unasked     MOBILE without the permission → red “it starts only …”
 *   prewarm-without-pause          delay(PAUSE_MS) removed → red “between batches …”
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

    private fun preview(number: Int) = "https://brick.example/api/v2/images/set/$number-1?thumb=1"

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
            "https://brick.example/api/v2/images/set/4-1"))
        assertEquals(listOf(preview(3)), posed.map { it.url.toString() })
        val request = posed.single()
        assertEquals("GET", request.method)
        assertTrue("The request does not carry the prewarmer's brand", request.tag(WarmUp::class.java) != null)
        assertEquals("The brand travels to the server as a header", 0, request.headers.size)
    }

    @Test
    fun `when the limit is reached it stops after the running batch`() = runTest {
        afterRequest = { if (posed.size == 1) fillUntilToLimit() }
        prewarmer.prewarm((10..15).map(::preview))
        assertEquals("A batch of two, then it stops", 2, posed.size)
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
        assertEquals("Default here: Wi-Fi only", mapOf(NetworkState.Kind.NO_NETWORK to false, NetworkState.Kind.WIFI to true,
            NetworkState.Kind.MOBILE to false, NetworkState.Kind.ROAMING to false), responses)
        allowed[PrewarmNetwork.MOBILE] = true
        situation = NetworkState.Kind.MOBILE
        assertTrue("With permission also on mobile data", prewarmer.mayStart())
        assertEquals("Prewarming goes up to four fifths of the store", 0.8,
            PreviewMemory.LIMIT_WARM_UP.toDouble() / PreviewMemory.MAX_BYTES, 1e-9)
        fillUntilToLimit()
        assertFalse("With a full store nothing starts", prewarmer.mayStart())
    }

    /**
     * Every state asks its own permission. A new state is missing in the mapping and turns
     * the test red instead of silently falling under an existing answer.
     * Counter-check (patch prewarm-roaming-as-mobile): ROAMING asks the permission of MOBILE → red here.
     */
    @Test
    fun `every network state follows its own permission`() = runTest {
        val assignment = mapOf(PrewarmNetwork.WIFI to NetworkState.Kind.WIFI, PrewarmNetwork.MOBILE to NetworkState.Kind.MOBILE,
            PrewarmNetwork.ROAMING to NetworkState.Kind.ROAMING)
        assertEquals("every permission has its situation", PrewarmNetwork.entries.toSet(), assignment.keys)
        for (network in PrewarmNetwork.entries) {
            PrewarmNetwork.entries.forEach { allowed[it] = it == network }
            val started = NetworkState.Kind.entries.filter { situation = it; prewarmer.mayStart() }
            assertEquals("only $network allowed", listOf(assignment.getValue(network)), started)
        }
    }

    @Test
    fun `between batches there is a pause`() = runTest {
        prewarmer.prewarm((20..23).map(::preview))
        assertEquals(4, posed.size)
        assertTrue("Two batches without a pause ($currentTime ms)", currentTime >= 2 * 250)
    }
}
