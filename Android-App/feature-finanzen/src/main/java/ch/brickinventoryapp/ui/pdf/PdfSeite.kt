package ch.brickinventoryapp.ui.pdf

import ch.brickinventoryapp.util.fangeAusserAbbruch
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.core.graphics.createBitmap
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
 * Verhältnis bleibt. Eigene Funktion, damit die Rechnung ohne Gerät prüfbar ist
 * (PdfZoomTest).
 */
internal fun bitmapMasse(breitePx: Int, ratio: Float): Pair<Int, Int> {
    var w = breitePx.coerceAtLeast(1)
    val flaeche = w.toFloat() * (w * ratio)
    if (flaeche > PDF_BITMAP_MAX_PX) w = (w * sqrt(PDF_BITMAP_MAX_PX / flaeche)).toInt()
    w = w.coerceAtLeast(1)
    return w to (w * ratio).toInt().coerceAtLeast(1)
}

/** Rendert Seite (Quelle, Index, Breite in Pixeln); der Bildschirm bekommt sie vom ViewModel. */
typealias SeitenRenderer = suspend (PdfQuelle, Int, Int) -> Bitmap?

// PdfRenderer ist nicht thread-safe und öffnet nur eine Seite gleichzeitig →
// alle Render-Zugriffe serialisieren.
private val pdfRenderMutex = Mutex()

/** Eine Seite in der Breite [targetWidthPx]; null, wenn PdfRenderer sie nicht lesen kann. */
internal suspend fun renderPdfPage(quelle: PdfQuelle, index: Int, targetWidthPx: Int): Bitmap? =
    pdfRenderMutex.withLock {
        var pfd: ParcelFileDescriptor? = null
        var renderer: PdfRenderer? = null
        try {
            fangeAusserAbbruch {
            val geoeffnet = quelle.oeffne().also { pfd = it }
            val leser = PdfRenderer(geoeffnet).also { renderer = it }
            if (index >= leser.pageCount) return@withLock null
            val page = leser.openPage(index)
            val ratio = page.height.toFloat() / page.width.toFloat().coerceAtLeast(1f)
            val (w, h) = bitmapMasse(targetWidthPx, ratio)
            // KTX-Form; ARGB_8888 ist dort die Vorbelegung (gelesen in
            // androidx.core.graphics.Bitmap.kt).
            val bmp = createBitmap(w, h)
            bmp.eraseColor(AndroidColor.WHITE)
            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            page.close()
            bmp
            }.getOrNull()
        } finally {
            renderer?.close()
            pfd?.close()
        }
    }
