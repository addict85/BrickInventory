package ch.brickinventoryapp

import android.content.Context
import coil3.ImageLoader
import coil3.asImage
import coil3.decode.DataSource
import coil3.intercept.Interceptor
import coil3.request.ImageResult
import coil3.request.SuccessResult

/**
 * Bilder für die Fototests: Jede Adresse, deren letzter Pfadteil ein Beispielbild
 * unter src/test/resources/beispielbilder nennt („/beispiel/set1.png“), bekommt
 * dieses Bild ohne Netz. Ohne sie zeigten alle Kacheln den Platzhalter, und ein Foto
 * sagte nichts über Bildausschnitt und Lesbarkeit auf einem Bild.
 */
object Beispielbilder {

    /** Der Name der Ressource zu [adresse], oder null, wenn es kein Beispielbild gibt. */
    fun ressource(adresse: String): String? {
        val name = adresse.substringBefore('?').substringAfterLast('/')
        val pfad = "beispielbilder/$name"
        return pfad.takeIf { name.endsWith(".png") && javaClass.classLoader?.getResource(it) != null }
    }

    fun loader(ctx: Context): ImageLoader = ImageLoader.Builder(ctx).components { add(Abfang) }.build()

    private object Abfang : Interceptor {
        override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
            val pfad = (chain.request.data as? String)?.let(::ressource) ?: return chain.proceed()
            val bitmap = javaClass.classLoader!!.getResourceAsStream(pfad).use { android.graphics.BitmapFactory.decodeStream(it) }
            // MEMORY_CACHE, damit Coil nicht überblendet: Robolectric zeichnet für das Foto
            // ein Bild, und eine Überblendung stand darin noch bei Deckkraft 0 — die
            // Kacheln mit crossfade(true) blieben leer.
            return SuccessResult(image = bitmap.asImage(), request = chain.request, dataSource = DataSource.MEMORY_CACHE)
        }
    }
}
