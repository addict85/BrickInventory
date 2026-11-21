package ch.brickinventoryapp.app

import android.content.Context
import coil3.ImageLoader
import coil3.asImage
import coil3.decode.DataSource
import coil3.intercept.Interceptor
import coil3.request.ImageResult
import coil3.request.SuccessResult
import android.graphics.BitmapFactory
import kotlinx.coroutines.Dispatchers

/**
 * Images for the photo tests: every address whose last path segment names a sample image
 * under src/test/resources/beispielbilder („/beispiel/set1.png“) gets
 * this image without network. Without them all tiles would show the placeholder, and a photo
 * would say nothing about image framing and legibility on an image.
 */
object SampleImages {

    /** The name of the resource for [adresse], or null if there is no sample image. */
    fun resource(adresse: String): String? {
        val name = adresse.substringBefore('?').substringAfterLast('/')
        val pfad = "beispielbilder/$name"
        return pfad.takeIf { name.endsWith(".png") && javaClass.classLoader?.getResource(it) != null }
    }

    /** On the main looper: that way a photo waits for no image from a foreign thread. */
    fun loader(ctx: Context): ImageLoader = ImageLoader.Builder(ctx).components { add(Intercept) }
        .coroutineContext(Dispatchers.Main.immediate).interceptorCoroutineContext(Dispatchers.Main.immediate).build()

    private object Intercept : Interceptor {
        override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
            val pfad = (chain.request.data as? String)?.let(::resource) ?: return chain.proceed()
            val bitmap = javaClass.classLoader!!.getResourceAsStream(pfad).use { BitmapFactory.decodeStream(it) }
            // MEMORY_CACHE so that Coil does not crossfade: Robolectric draws one image for the
            // photo, and a crossfade stood in it still at opacity 0 — the
            // tiles with crossfade(true) stayed empty.
            return SuccessResult(image = bitmap.asImage(), request = chain.request, dataSource = DataSource.MEMORY_CACHE)
        }
    }
}
