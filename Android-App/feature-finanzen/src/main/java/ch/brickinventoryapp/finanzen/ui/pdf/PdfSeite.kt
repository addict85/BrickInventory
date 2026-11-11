package ch.brickinventoryapp.finanzen.ui.pdf

import android.graphics.Bitmap
import ch.brickinventoryapp.model.koroutinen.BrickDispatchers
import ch.brickinventoryapp.model.koroutinen.Dispatcher
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

/** Mehr Seiten nimmt der Betrachter nicht an; die Zahl kommt aus dem Renderer und gilt als fremd. */
internal const val PDF_MAX_SEITEN = 10_000

/** Die grösste Seitenkante, die das PDF-Format erlaubt (200 Zoll in Punkten). */
internal const val PDF_SEITE_MAX_PT = 14_400

/** Längste Kante einer Seiten-Bitmap; mehr lässt sich als Textur nicht zeichnen. */
internal const val PDF_KANTE_MAX_PX = 16_384

/** Masse einer Seiten-Bitmap, im Hauptprozess bestimmt; [bytes] ist die Grösse des geteilten Speichers. */
internal class SeitenMasse(val breite: Int, val hoehe: Int) {
    val bytes: Int get() = breite * hoehe * 4
}

/** Die Seitenzahl des Renderers, oder null, wenn sie nicht stimmen kann. */
internal fun pruefeSeitenzahl(n: Int): Int? = n.takeIf { it in 1..PDF_MAX_SEITEN }

/**
 * Masse aus den Seitenkanten des Renderers ([breitePt], [hoehePt]); null, wenn diese
 * ausserhalb des Formats liegen. Die Fläche begrenzt [bitmapMasse], hier zur Sicherheit noch einmal.
 */
internal fun seitenMasse(breitePx: Int, breitePt: Int, hoehePt: Int): SeitenMasse? {
    if (breitePt !in 1..PDF_SEITE_MAX_PT || hoehePt !in 1..PDF_SEITE_MAX_PT) return null
    val ratio = hoehePt.toFloat() / breitePt
    var (w, h) = bitmapMasse(breitePx.coerceIn(1, PDF_KANTE_MAX_PX), ratio)
    // Eine sehr hohe Seite wird schmaler gerendert, bis auch die Höhe passt.
    if (h > PDF_KANTE_MAX_PX) bitmapMasse((w.toLong() * PDF_KANTE_MAX_PX / h).toInt().coerceAtLeast(1), ratio).let { (b, n) -> w = b; h = n }
    return SeitenMasse(w, h).takeIf { h <= PDF_KANTE_MAX_PX && w.toLong() * h <= PDF_BITMAP_MAX_PX }
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
