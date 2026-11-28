package ch.brickinventoryapp.app

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.catalog.ui.screens.CatalogSetCard
import ch.brickinventoryapp.collection.ui.screens.SetCard
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.domain.CatalogSetView
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.SetView
import ch.brickinventoryapp.parts.ui.screens.MinifigCard
import ch.brickinventoryapp.parts.ui.screens.PartCard
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import coil3.ImageLoader
import coil3.asImage
import coil3.decode.DataSource
import coil3.intercept.Interceptor
import coil3.request.ErrorResult
import coil3.request.ImageResult
import coil3.request.SuccessResult
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Every tile loads the server's preview first and, if that fails, the full resolution once
 * (the gallery tile retries each address once after a second); after that no tile asks again. The address comes from the
 * server's local path (with `serverUrl` in front), not from the CDN.
 *
 * Counter-check (run here): `onImageError()` no longer called in the gallery's SetCard → red
 * “the set tile falls back to the full resolution once”.
 * Counter-check (run here): `retryNonce == 0` → `retryNonce >= 0` in SetCard → red
 * “the gallery tile retries each address once …” (endless retries).
 * Counter-check (run here): `AsyncImagePainter.State.Error) onThumbError()` removed from
 * CatalogSetCard → red “the catalog tile falls back …”.
 * Counter-check (run here): `useFallback = true` replaced by `useFallback = !useFallback` in
 * rememberTileImageWithFallback → red “the gallery tile retries each address once …”.
 * Counter-check (run here): `serverUrl` replaced by "" in PartCard's rememberTileImageWithFallback
 * call → red “a part tile falls back …”.
 */
@RunWith(RobolectricTestRunner::class)
@Config(qualifiers = "de-rCH-w411dp-h891dp-port-xxhdpi")
class TileImageFallbackTest {

    @get:Rule
    val compose = createComposeRule()

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val server = "http://nas:3000"

    /** Records every requested address; previews (`_thumb`) fail, full images load unless [failAll]. */
    private class Recorder(val failAll: Boolean) : Interceptor {
        val requests = mutableListOf<String>()
        override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
            val address = chain.request.data.toString()
            requests += address
            if (failAll || "_thumb" in address) return ErrorResult(null, chain.request, IllegalStateException("404"))
            val bitmap = Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888)
            return SuccessResult(image = bitmap.asImage(), request = chain.request, dataSource = DataSource.MEMORY_CACHE)
        }
    }

    private fun requests(failAll: Boolean = false, count: Int = 2, tile: @Composable (ImageLoader) -> Unit): List<String> {
        val recorder = Recorder(failAll)
        val loader = ImageLoader.Builder(ctx).components { add(recorder) }
            .coroutineContext(Dispatchers.Main.immediate).interceptorCoroutineContext(Dispatchers.Main.immediate).build()
        compose.setContent { BrickInventoryManagerTheme(theme = Design.CLASSIC) { tile(loader) } }
        // The gallery tile retries after a second; the clock is moved on until the requests stop.
        repeat(10) {
            compose.mainClock.advanceTimeBy(500)
            driveUntil("images") { recorder.requests.size >= minOf(count, 1) }
        }
        return recorder.requests.toList()
    }

    private fun expected(path: String) = listOf("$server$path", server + path.replace("_thumb", ""))

    /** The gallery tile asks for the preview a second time, a second later, before falling back. */
    private fun withRetry(path: String) = listOf("$server$path") + expected(path)

    @Test
    fun `the set tile falls back to the full resolution once`() {
        val set = SetView(setNumber = "75192-1", name = "Millennium Falcon", imageLocal = "/images/sets/75192-1_thumb.jpg")
        assertEquals(withRetry("/images/sets/75192-1_thumb.jpg"), requests(count = 3) { SetCard(set, server, it, onClick = {}) })
    }

    @Test
    fun `the catalog tile falls back to the full resolution once`() {
        val set = CatalogSetView(setNumber = "10305-1", name = "Lion Knights' Castle", imageLocal = "/images/sets/10305-1_thumb.jpg")
        assertEquals(expected("/images/sets/10305-1_thumb.jpg"),
            requests { CatalogSetCard(set, imageLoader = it, serverUrl = server, onClick = {}) })
    }

    @Test
    fun `a part tile falls back to the full resolution once`() {
        val part = PartView(partNumber = "3001", partName = "Brick 2 x 4", imageLocal = "/images/parts/3001_thumb.png")
        assertEquals("part", expected("/images/parts/3001_thumb.png"),
            requests { PartCard(part, serverUrl = server, imageLoader = it, onClick = {}) })
    }

    @Test
    fun `a figure tile falls back to the full resolution once`() {
        val figure = FigureView(figNumber = "sw0001a", figName = "Battle Droid", imageLocal = "/images/minifigs/sw0001a_thumb.png")
        assertEquals("figure", expected("/images/minifigs/sw0001a_thumb.png"),
            requests { MinifigCard(figure, serverUrl = server, imageLoader = it, onClick = {}) })
    }

    @Test
    fun `the gallery tile retries each address once, then asks no more`() {
        val set = SetView(setNumber = "75192-1", name = "Millennium Falcon", imageLocal = "/images/sets/75192-1_thumb.jpg")
        val full = "$server/images/sets/75192-1.jpg"
        assertEquals(withRetry("/images/sets/75192-1_thumb.jpg") + full,
            requests(failAll = true, count = 4) { SetCard(set, server, it, onClick = {}) })
    }
}
