package ch.brickinventoryapp.finanzen.ui.pdf

import android.graphics.Bitmap
import ch.brickinventoryapp.data.di.BrickDispatchers
import ch.brickinventoryapp.data.di.Dispatcher
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import javax.inject.Inject
import kotlin.math.sqrt

/**
 * Obergrenze einer Seiten-Bitmap in Pixeln der Fläche: 8 Millionen ARGB-Pixel sind
 * rund 32 MB. Begrenzt wird die Fläche, weil sie den Speicher bestimmt; wird sie
 * erreicht, wird die Seite nur weicher, nicht falsch.
 */
internal const val PDF_BITMAP_MAX_PX = 8_000_000

/**
 * Masse der Seiten-Bitmap: die gewünschte Breite, auf [PDF_BITMAP_MAX_PX]
 * begrenzt.
 *
 * @param breitePx gewünschte Breite in Pixeln
 * @param ratio Höhe geteilt durch Breite der PDF-Seite
 * @return (Breite, Höhe) in Pixeln, beide mindestens 1
 *
 * Gekappt wird mit der Wurzel, damit beide Seiten gleich schrumpfen und das
 * Verhältnis bleibt. Eigene Funktion, damit die Rechnung ohne Gerät prüfbar ist.
 */
internal fun bitmapMasse(breitePx: Int, ratio: Float): Pair<Int, Int> {
    var w = breitePx.coerceAtLeast(1)
    val flaeche = w.toFloat() * (w * ratio)
    if (flaeche > PDF_BITMAP_MAX_PX) w = (w * sqrt(PDF_BITMAP_MAX_PX / flaeche)).toInt()
    w = w.coerceAtLeast(1)
    return w to (w * ratio).toInt().coerceAtLeast(1)
}

/** Rendert Seite (Quelle, Index, Breite in Pixeln); der Bildschirm bekommt sie vom ViewModel. */
internal typealias SeitenRenderer = suspend (PdfQuelle, Int, Int) -> Bitmap?

/** Eine Seite als Bild; das ViewModel reicht die Quelle nur durch und kennt kein Bitmap. */
fun interface PdfSeitenQuelle {
    suspend fun seite(quelle: PdfQuelle, index: Int, breitePx: Int): Bitmap?
}

/** Gerendert im isolierten Prozess; der Aufruf dorthin blockiert, also nicht auf Main. */
internal class PdfRendererSeiten @Inject constructor(
    private val renderer: PdfRenderVerbindung,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : PdfSeitenQuelle {
    override suspend fun seite(quelle: PdfQuelle, index: Int, breitePx: Int): Bitmap? =
        withContext(io) { renderer.seite(quelle, index, breitePx) }
}
