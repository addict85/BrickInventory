package ch.brickinventoryapp.app

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.lifecycle.ViewModel
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.app.testing.HiltTestActivity
import ch.brickinventoryapp.app.testing.RegisterHiltTestActivity
import ch.brickinventoryapp.app.testing.TestApp
import ch.brickinventoryapp.data.testing.testCatalogRepository
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.testing.NumbersTexts
import coil3.ImageLoader
import coil3.asImage
import coil3.decode.DataSource
import coil3.intercept.Interceptor
import coil3.request.ImageResult
import coil3.request.SuccessResult
import kotlinx.coroutines.Dispatchers
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.RuleChain
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The catalog graph hands the server address to the detail screen: opened through the tab
 * and a tile, the detail loads its image from the own server, in full resolution.
 *
 * Counter-checks (local, Robolectric):
 *   `serverUrl = state.serverUrl` → `serverUrl = ""` in CatalogDetailTarget → red (address without server)
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
class CatalogDetailServerTest {

    private val compose = createAndroidComposeRule<HiltTestActivity>()

    @get:Rule
    val rules: RuleChain = RuleChain.outerRule(RegisterHiltTestActivity()).around(compose)

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    private class Recorder : Interceptor {
        val requests = mutableListOf<String>()
        override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
            requests += chain.request.data.toString()
            val bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888)
            return SuccessResult(image = bitmap.asImage(), request = chain.request, dataSource = DataSource.MEMORY_CACHE)
        }
    }

    private val recorder = Recorder()
    private val app = TestApp(images = ImageLoader.Builder(ctx).components { add(recorder) }
        .coroutineContext(Dispatchers.Main.immediate).interceptorCoroutineContext(Dispatchers.Main.immediate).build())

    @After fun tearDown() = app.close()

    private fun idle() { driveUntil("idle", { app.world.paths.requests.size }) { true }; compose.waitForIdle() }

    /** The catalog's ViewModel is module-internal; its constructor is reached the way Hilt reaches it. */
    @Suppress("UNCHECKED_CAST")
    private fun registerCatalog() {
        val t = app.world.t
        val type = Class.forName("ch.brickinventoryapp.catalog.ui.viewmodel.CatalogViewModel") as Class<ViewModel>
        app.viewModels.put(type) {
            type.constructors.single().newInstance(testCatalogRepository(t.api), t.messages, NumbersTexts,
                t.wantedList(), t.alerts(), t.scrollMemory) as ViewModel
        }
    }

    @Test
    fun `the catalog graph hands the server address to the detail screen`() {
        val paths = app.world.paths.responses
        paths["/api/v1/catalog/meta"] = """{"success":true,"themes":[],"year_counts":[]}"""
        paths["/api/v1/catalog/year-verteilung"] = """{"success":true,"years":[]}"""
        paths["/api/v1/catalog/sets"] = """{"success":true,"total":1,"page":1,"page_size":60,"pages":1,
            "sets":[{"set_number":"10305-1","name":"Lion Knights' Castle","year":2022,"image_local":"/images/sets/10305-1_thumb.jpg"}]}"""
        paths["/api/v1/catalog/sets/10305-1"] = """{"success":true,"set":{"set_number":"10305-1","name":"Lion Knights' Castle",
            "year":2022,"image_local":"/images/sets/10305-1_thumb.jpg"}}"""
        registerCatalog()
        app.show(compose)
        idle()
        compose.onAllNodes(hasText(ctx.getString(R.string.nav_catalog)) and hasClickAction()).onFirst().performClick()
        idle()
        compose.onAllNodes(hasText("Lion Knights' Castle", substring = true) and hasClickAction()).onFirst().performClick()
        idle()
        val full = "${TestApp.SERVER}/images/sets/10305-1.jpg"
        assertTrue("requested: ${recorder.requests}", full in recorder.requests)
    }
}
