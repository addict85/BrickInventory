package ch.brickinventoryapp.catalog

import ch.brickinventoryapp.ui.components.LocalAddressRules
import ch.brickinventoryapp.network.util.NetworkAddressRules
import androidx.compose.runtime.CompositionLocalProvider
import android.content.Context
import android.graphics.Bitmap
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.catalog.ui.CatalogUiState
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailActions
import ch.brickinventoryapp.catalog.ui.screens.CatalogDetailScreen
import ch.brickinventoryapp.catalog.ui.screens.CatalogScreen
import ch.brickinventoryapp.catalog.ui.viewmodel.CatalogActions
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.CatalogSort
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.uistate.Load
import coil3.ImageLoader
import coil3.asImage
import coil3.decode.DataSource
import coil3.intercept.Interceptor
import coil3.request.ImageResult
import coil3.request.SuccessResult
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The catalog loads a set's image from the own server when the server already stores it
 * (`imageLocal`), in the grid as in the detail; the CDN address is only the fallback.
 *
 * Counter-checks (local, Robolectric):
 *   CatalogCard passes `null` instead of set.imageLocal            → red “the catalog grid …” (proxy address)
 *   CatalogDetailScreen passes `null` instead of detail.imageLocal → red “the catalog detail …”
 *   CatalogScreen passes "" instead of serverUrl to the card       → red “the catalog grid …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "w411dp-h891dp-port-xxhdpi")
class CatalogLocalImagesTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val server = "http://nas:3000"
    private val cdn = "https://cdn.rebrickable.com/media/sets/75192-1.jpg"

    /** Records every requested address and answers each with a tiny bitmap. */
    private class Recorder : Interceptor {
        val requests = mutableListOf<String>()
        override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
            requests += chain.request.data.toString()
            val bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888)
            return SuccessResult(image = bitmap.asImage(), request = chain.request, dataSource = DataSource.MEMORY_CACHE)
        }
    }

    private val recorder = Recorder()
    private val images = ImageLoader.Builder(ctx).components { add(recorder) }
        .coroutineContext(Dispatchers.Main.immediate).interceptorCoroutineContext(Dispatchers.Main.immediate).build()

    private object Silent : CatalogActions {
        override fun loadCatalogMeta() = Unit
        override fun loadCatalogSets() = Unit
        override fun catalogVisible(firstPage: Int, lastPage: Int) = Unit
        override fun scrollCatalogTo(number: Int) = Unit
        override fun catalogScrollConsumed() = Unit
        override fun setCatalogQuery(q: String) = Unit
        override fun setCatalogTheme(themeId: Int?) = Unit
        override fun setCatalogYear(year: Int?) = Unit
        override fun setCatalogSort(sort: CatalogSort) = Unit
    }

    @Test
    fun `the catalog grid loads the server's own preview`() {
        val set = CatalogSetView(setNumber = "75192-1", name = "Millennium Falcon",
            imageLocal = "/images/sets/75192-1_thumb.jpg", imageUrl = cdn)
        val state = CatalogUiState(total = 1, loadedPages = mapOf(1 to listOf(set)))
        compose.setContent { CompositionLocalProvider(LocalAddressRules provides NetworkAddressRules) {  BrickInventoryManagerTheme { CatalogScreen(state, server, Silent, images, onSetClick = {}) }  }}
        compose.waitForIdle()
        assertEquals(listOf("$server/images/sets/75192-1_thumb.jpg"), recorder.requests.distinct())
    }

    @Test
    fun `the catalog detail loads the server's own full image`() {
        val detail = CatalogDetailView(setNumber = "75192-1", name = "Millennium Falcon",
            imageLocal = "/images/sets/75192-1_thumb.jpg", imageUrl = cdn)
        compose.setContent { CompositionLocalProvider(LocalAddressRules provides NetworkAddressRules) { 
            BrickInventoryManagerTheme {
                CatalogDetailScreen(setNumber = "75192-1", loaded = Load.Data(detail), imageLoader = images,
                    serverUrl = server, actions = object : CatalogDetailActions {})
            }
         }}
        compose.waitForIdle()
        assertTrue("requested: ${recorder.requests}", recorder.requests.isNotEmpty())
        assertEquals(listOf("$server/images/sets/75192-1.jpg"), recorder.requests.distinct())
    }
}
