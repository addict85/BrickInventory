package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.Credentials
import ch.brickinventoryapp.data.NetworkState
import ch.brickinventoryapp.data.cache.PreviewMemory
import ch.brickinventoryapp.data.cache.PreviewPrewarmer
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testAccountView
import ch.brickinventoryapp.data.testing.testHouseholdRepository
import ch.brickinventoryapp.data.testing.testMinifigsRepository
import ch.brickinventoryapp.data.testing.testNetworkState
import ch.brickinventoryapp.data.testing.testPartsRepository
import ch.brickinventoryapp.data.testing.testSetsRepository
import ch.brickinventoryapp.dataapi.device.DevicesSettings
import ch.brickinventoryapp.dataapi.device.PrewarmNetwork
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.state.testing.StorageStore
import ch.brickinventoryapp.state.ui.CollectionWarmUp
import ch.brickinventoryapp.state.ui.ScopeService
import ch.brickinventoryapp.state.ui.imageAddressesTheCollection
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Which images are warmed up, against a test server: the tiles of all tabs of the
 * own collection (sets, parts, figures, manually captured parts and figures), each
 * from the tab's own source — with an account filter, the account view — and nothing from the
 * catalog, whose roughly 25,000 sets would blow past the limit many times over.
 *
 * Counter-checks (patches under counter-checks/):
 *   prewarm-without-viewport  the parts fetched without the account filter → red „vorgewärmt wird …“
 *   prewarm-without-figures    the figures no longer collected → red „vorgewärmt wird …“
 * Counter-checks (run here): `delay(RAMP_UP_MS)` removed from CollectionWarmUp.kick → red “the app start
 * waits …”; the `mayStart()` question removed → red, the same test.
 */
class CollectionWarmUpTest {

    private val responses = arrayOf(
        "/api/v2/sets" to """{"success":true,"total":1,"sets":[{"set_number":"75192-1","name":"Falke","image_local":"/b/set_thumb.jpg"}]}""",
        "/api/v2/parts" to """{"success":true,"total":1,"parts":[{"part_number":"3001","color_id":5,"part_name":"Brick","color_name":"Red","image_local":"/b/teil_thumb.jpg","total_quantity":2}]}""",
        "/api/v2/minifigs" to """{"success":true,"figs":[{"fig_number":"sw0001","fig_name":"Luke","image_local":"/b/figur_thumb.jpg","quantity":1}]}""",
        "/api/v2/parts/manual" to """{"success":true,"parts":[{"id":9,"part_number":"3002","part_name":"Brick 2x3","color_id":5,"color_name":"Red","quantity":1,"image_local":"/b/mteil_thumb.jpg"}]}""",
        "/api/v2/minifigs/manual" to """{"success":true,"figs":[{"id":3,"fig_number":"sw0002","fig_name":"Han","quantity":1,"image_local":"/b/mfigur_thumb.jpg"}]}""",
    )

    @Test
    fun `every tab of the collection in view is warmed, not the catalog`() {
        val paths = PathServer(*responses)
        val folder = File(System.getProperty("java.io.tmpdir"), "bim-sammlung-${System.nanoTime()}").apply { mkdirs() }
        try {
            val api = TestApi.forTarget(paths.server)
            val parts = testPartsRepository(api)
            val viewport = ScopeService(StorageStore(), testHouseholdRepository(api), parts)
            val addresses = runBlocking {
                for (v in listOf(ScopeFilter.View.GALLERY, ScopeFilter.View.PARTS, ScopeFilter.View.MINIFIGS)) viewport.setAccount(v, "own")
                imageAddressesTheCollection(testSetsRepository(api), parts, testMinifigsRepository(api), testAccountView(api), viewport,
                    "https://brick.example")
            }
            assertEquals(listOf("set", "teil", "figur", "mteil", "mfigur").map { "https://brick.example/b/${it}_thumb.jpg" },
                addresses)
            val asked = paths.requests.toList()
            assertEquals(setOf("/api/v2/sets", "/api/v2/parts", "/api/v2/minifigs", "/api/v2/parts/manual", "/api/v2/minifigs/manual"),
                asked.map { it.substringAfter(' ').substringBefore('?') }.toSet())
            assertTrue("without account filter: $asked", asked.all { "accounts=own" in it })
            assertTrue("read-only: $asked", asked.all { it.startsWith("GET ") })
        } finally {
            paths.server.shutdown()
            folder.deleteRecursively()
        }
    }

    /** The app start: [situation] decides whether warming may start; the lists come from [paths]. */
    private fun TestScope.warmUp(paths: PathServer, situation: NetworkState.Kind): CollectionWarmUp {
        val api = paths.onTick()
        val parts = testPartsRepository(api)
        val root = File(System.getProperty("java.io.tmpdir"), "bim-start-${System.nanoTime()}")
        val memory = PreviewMemory({ root }, StoreCipher { ByteArray(32) { 9 } }) { ByteArray(32) { 19 } }
        val settings = object : DevicesSettings {
            override val alarmMessagesEnabled: Flow<Boolean> = MutableStateFlow(false)
            override suspend fun setAlarmMessages(an: Boolean) = Unit
            override fun warmUpAllowed(network: PrewarmNetwork): Flow<Boolean> = flowOf(network == PrewarmNetwork.WIFI)
            override suspend fun warmUpSet(network: PrewarmNetwork, allowed: Boolean) = Unit
        }
        val images = OkHttpClient.Builder().addInterceptor { chain ->
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(404).message("x")
                .body("".toResponseBody("image/jpeg".toMediaType())).build()
        }.build()
        val prewarmer = PreviewPrewarmer(memory, testNetworkState { situation }, settings, images)
        val credentials = object : Credentials {
            override suspend fun serverUrlNow() = "https://brick.example"
            override suspend fun tokenNow() = "token"
        }
        return CollectionWarmUp(prewarmer, testSetsRepository(api), parts, testMinifigsRepository(api), testAccountView(api),
            ScopeService(StorageStore(), testHouseholdRepository(api), parts), credentials, backgroundScope)
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `the app start waits for the ramp-up and asks before collecting`() = runTest {
        val paths = PathServer(*responses)
        try {
            warmUp(paths, NetworkState.Kind.WIFI).kick()
            advanceTimeBy(PreviewPrewarmer.RAMP_UP_MS - 1)
            assertEquals("collected during sign-in and the first tiles", emptyList<String>(), paths.requests.toList())
            advanceTimeBy(2)
            runCurrent()
            assertTrue("never collected", paths.requests.isNotEmpty())

            paths.requests.clear()
            warmUp(paths, NetworkState.Kind.NO_NETWORK).kick()
            advanceTimeBy(PreviewPrewarmer.RAMP_UP_MS * 2)
            runCurrent()
            assertEquals("collected without being allowed to warm", emptyList<String>(), paths.requests.toList())
        } finally {
            paths.server.shutdown()
        }
    }
}
