package ch.brickinventoryapp.finanzen.ui.pdf

import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.Binder
import android.os.DeadObjectException
import android.os.IBinder
import android.os.Parcel
import androidx.core.graphics.createBitmap
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val SCHNITTSTELLE = "ch.brickinventoryapp.pdf.Renderer"
private const val SEITENZAHL = IBinder.FIRST_CALL_TRANSACTION
private const val SEITE = IBinder.FIRST_CALL_TRANSACTION + 1

/**
 * PDFs kommen inhaltlich von Dritten, pdfium ist nativer Code. Gerendert wird darum in
 * einem isolierten Prozess (Manifest: isolatedProcess) ohne Berechtigungen, Dateien,
 * Token und Ablageschlüssel; er bekommt nur den Deskriptor und gibt Bitmaps zurück.
 */
class PdfRenderDienst : Service() {
    override fun onBind(intent: Intent?): IBinder = Renderer()

    private class Renderer : Binder() {
        override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
            if (code != SEITENZAHL && code != SEITE) return super.onTransact(code, data, reply, flags)
            data.enforceInterface(SCHNITTSTELLE)
            val antwort = checkNotNull(reply)
            // PdfRenderer ist nicht thread-safe; Binder-Fäden kommen gleichzeitig.
            synchronized(this) {
                val pfd = data.readFileDescriptor()
                val ergebnis = fangeAusserAbbruch {
                    PdfRenderer(checkNotNull(pfd)).use { leser ->
                        if (code == SEITENZAHL) leser.pageCount else seite(leser, data.readInt(), data.readInt())
                    }
                }.getOrNull()
                runCatching { pfd?.close() }
                when (ergebnis) {
                    is Int -> antwort.writeInt(ergebnis)
                    is Bitmap -> { antwort.writeInt(1); ergebnis.writeToParcel(antwort, 0) }
                    else -> antwort.writeInt(-1)
                }
            }
            return true
        }

        private fun seite(leser: PdfRenderer, index: Int, breitePx: Int): Bitmap? {
            if (index !in 0 until leser.pageCount) return null
            return leser.openPage(index).use { page ->
                val ratio = page.height.toFloat() / page.width.toFloat().coerceAtLeast(1f)
                val (w, h) = bitmapMasse(breitePx, ratio)
                createBitmap(w, h).also {
                    it.eraseColor(Color.WHITE)
                    page.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                }
            }
        }
    }
}

/** Die Seite der App: bindet den Dienst einmal und reicht Deskriptoren hinüber. */
@Singleton
class PdfRenderVerbindung @Inject constructor(@param:ApplicationContext private val ctx: Context) {
    private val sperre = Mutex()
    @Volatile private var binder: IBinder? = null

    /** Seitenzahl; wirft, wenn das PDF nicht lesbar ist (der Lader lädt dann neu). */
    suspend fun seitenzahl(quelle: PdfQuelle): Int =
        rufe(SEITENZAHL, quelle, {}) { it.readInt() }.takeIf { it >= 0 } ?: throw IOException("PDF nicht lesbar")

    /** Eine Seite in der Breite [breitePx]; null, wenn sie sich nicht rendern lässt. */
    suspend fun seite(quelle: PdfQuelle, index: Int, breitePx: Int): Bitmap? = fangeAusserAbbruch {
        rufe(SEITE, quelle, { writeInt(index); writeInt(breitePx) }) { r ->
            if (r.readInt() == 1) Bitmap.CREATOR.createFromParcel(r) else null
        }
    }.getOrNull()

    private suspend fun <T> rufe(code: Int, quelle: PdfQuelle, argumente: Parcel.() -> Unit, lies: (Parcel) -> T): T =
        sperre.withLock {
            // Ein abgestürzter Renderer (etwa an einem bösartigen PDF) wird einmal neu gebunden.
            try {
                sende(verbunden(), code, quelle, argumente, lies)
            } catch (_: DeadObjectException) {
                binder = null
                sende(verbunden(), code, quelle, argumente, lies)
            }
        }

    private fun <T> sende(b: IBinder, code: Int, quelle: PdfQuelle, argumente: Parcel.() -> Unit, lies: (Parcel) -> T): T {
        val daten = Parcel.obtain()
        val antwort = Parcel.obtain()
        try {
            quelle.oeffne().use { pfd ->
                daten.writeInterfaceToken(SCHNITTSTELLE)
                daten.writeFileDescriptor(pfd.fileDescriptor)
                daten.argumente()
                if (!b.transact(code, daten, antwort, 0)) throw IOException("PDF-Renderer antwortet nicht")
            }
            return lies(antwort)
        } finally {
            daten.recycle()
            antwort.recycle()
        }
    }

    private suspend fun verbunden(): IBinder = binder?.takeIf { it.isBinderAlive } ?: verbinde().also { binder = it }

    private suspend fun verbinde(): IBinder = suspendCancellableCoroutine { fortsetzung ->
        val verbindung = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder) {
                // Nach einem Absturz verbindet das System von selbst neu.
                if (fortsetzung.isActive) fortsetzung.resume(service) else binder = service
            }
            override fun onServiceDisconnected(name: ComponentName?) { binder = null }
            override fun onNullBinding(name: ComponentName?) {
                if (fortsetzung.isActive) fortsetzung.resumeWithException(IOException("PDF-Renderer ohne Schnittstelle"))
            }
        }
        if (!ctx.bindService(Intent(ctx, PdfRenderDienst::class.java), verbindung, Context.BIND_AUTO_CREATE)) {
            fortsetzung.resumeWithException(IOException("PDF-Renderer nicht erreichbar"))
        }
    }
}
