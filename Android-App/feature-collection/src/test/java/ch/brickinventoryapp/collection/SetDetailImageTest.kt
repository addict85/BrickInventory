package ch.brickinventoryapp.collection

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.collection.ui.SetDetailUiState
import ch.brickinventoryapp.collection.ui.screens.SetDetailScreen
import ch.brickinventoryapp.collection.ui.screens.SetDetailState
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailActions
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.network.util.NetworkAddressRules
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.StorageUiState
import ch.brickinventoryapp.ui.components.LocalAddressRules
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
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
 * The set detail shows the full resolution, not the tile's preview, and the zoom loads the
 * same address: the server's `_thumb` path loses its suffix.
 *
 * Counter-checks (local, Robolectric):
 *   `resolveFullUrl` → `resolveThumbUrl` in SetDetailScreen → red (`_thumb` requested)
 *   the zoom dialog gets `set.imageUrl` instead of imageUrl   → red (CDN address requested)
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w1000dp-h900dp-land")
class SetDetailImageTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val server = "http://nas:3000"

    private class Recorder : Interceptor {
        val requests = mutableListOf<String>()
        override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
            requests += chain.request.data.toString()
            val bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888)
            return SuccessResult(image = bitmap.asImage(), request = chain.request, dataSource = DataSource.MEMORY_CACHE)
        }
    }

    private object Silent : SetDetailActions {
        override fun refresh() = Unit
        override fun setPriceAlert(setNumber: String, direction: AlarmDirection, raw: String, condition: Condition) = Unit
        override fun changeQuantityBy(setNumber: String, step: Int) = Unit
        override fun setSetLocation(setNumber: String, location: String) = Unit
        override fun loadLocationStock(owner: List<Int>) = Unit
        override fun loadInstructionHigh(setNumber: String, file: FileRef) = Unit
        override fun deleteInstruction(setNumber: String, instrId: Int) = Unit
    }

    @Test
    fun `SetDetailScreen shows the same full resolution for preview and zoom`() {
        val recorder = Recorder()
        val images = ImageLoader.Builder(ctx).components { add(recorder) }
            .coroutineContext(Dispatchers.Main.immediate).interceptorCoroutineContext(Dispatchers.Main.immediate).build()
        val set = SetView("75192-1", name = "Millennium Falcon", quantity = 1,
            imageLocal = "/images/sets/75192-1_thumb.jpg", imageUrl = "https://cdn.rebrickable.com/media/sets/75192-1.jpg")
        val condition = SetDetailState(AppUiState(currency = CurrencyCode.CHF), SetDetailUiState(setDetail = set), StorageUiState())
        compose.setContent { CompositionLocalProvider(LocalAddressRules provides NetworkAddressRules) {
            BrickInventoryManagerTheme(theme = Design.CLASSIC) {
                SetDetailScreen(setNumber = "75192-1", condition = condition, actions = Silent,
                    serverUrl = server, imageLoader = images, onBack = {}, onDelete = {})
            }
         } }
        compose.waitForIdle()
        val full = "$server/images/sets/75192-1.jpg"
        assertEquals(listOf(full), recorder.requests.distinct())
        val before = recorder.requests.size
        compose.onNode(hasContentDescription("Millennium Falcon") and hasClickAction()).performClick()
        compose.waitForIdle()
        assertTrue("the zoom requested nothing", recorder.requests.size > before)
        assertEquals(listOf(full), recorder.requests.distinct())
    }
}
