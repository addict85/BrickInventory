package ch.brickinventoryapp.finances.ui.pdf

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
import android.os.SharedMemory
import androidx.core.graphics.createBitmap
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.io.IOException
import java.nio.ByteBuffer
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val INTERFACE = "ch.brickinventoryapp.pdf.Renderer"
private const val PAGE_COUNT = IBinder.FIRST_CALL_TRANSACTION
private const val PAGE = IBinder.FIRST_CALL_TRANSACTION + 1
private const val DIMENSIONS = IBinder.FIRST_CALL_TRANSACTION + 2
private const val MISSING = -1

/**
 * PDFs kommen inhaltlich von Dritten, pdfium ist nativer Code. Gerendert wird darum in
 * einem isolierten Prozess (Manifest: isolatedProcess) ohne Berechtigungen, Dateien,
 * Token und Ablageschlüssel. Er bekommt den Deskriptor nur lesend und schreibt Pixel in
 * einen Speicher, dessen Grösse der Hauptprozess festlegt; Objekte gibt er keine zurück.
 */
internal class PdfRenderDienst : Service() {
    override fun onBind(intent: Intent?): IBinder = Renderer()

    private class Renderer : Binder() {
        override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
            if (code != PAGE_COUNT && code != PAGE && code != DIMENSIONS) return super.onTransact(code, data, reply, flags)
            data.enforceInterface(INTERFACE)
            val antwort = checkNotNull(reply)
            // PdfRenderer ist nicht thread-safe; Binder-Fäden kommen gleichzeitig.
            synchronized(this) {
                val pfd = data.readFileDescriptor()
                val ergebnis = fangeAusserAbbruch {
                    PdfRenderer(checkNotNull(pfd)).use { reader ->
                        when (code) {
                            PAGE_COUNT -> intArrayOf(reader.pageCount)
                            DIMENSIONS -> dimensions(reader, data.readInt())
                            else -> seite(reader, data)
                        }
                    }
                }.getOrNull()
                runCatching { pfd?.close() }
                antwort.writeInt(ergebnis?.size ?: MISSING)
                ergebnis?.forEach(antwort::writeInt)
            }
            return true
        }

        private fun dimensions(reader: PdfRenderer, index: Int): IntArray? {
            if (index !in 0 until reader.pageCount) return null
            return reader.openPage(index).use { intArrayOf(it.width, it.height) }
        }

        /** Rendert in die Masse des Hauptprozesses und kopiert die Pixel in dessen Speicher. */
        private fun seite(reader: PdfRenderer, data: Parcel): IntArray? {
            val index = data.readInt()
            val w = data.readInt()
            val h = data.readInt()
            SharedMemory.CREATOR.createFromParcel(data).use { speicher ->
                if (index !in 0 until reader.pageCount || w <= 0 || h <= 0 || speicher.size.toLong() != w.toLong() * h * 4) return null
                val bild = createBitmap(w, h)
                try {
                    bild.eraseColor(Color.WHITE)
                    reader.openPage(index).use { it.render(bild, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY) }
                    val puffer = speicher.mapReadWrite()
                    try {
                        bild.copyPixelsToBuffer(puffer)
                    } finally {
                        SharedMemory.unmap(puffer)
                    }
                } finally {
                    bild.recycle()
                }
            }
            return intArrayOf()
        }
    }
}

/**
 * Baut die Seite im Hauptprozess aus dem geteilten Speicher: Masse und Format stammen
 * von hier, aus dem Renderer kommen nur Pixel. Null, wenn der Puffer nicht genau passt.
 */
internal fun bitmapFromBuffer(puffer: ByteBuffer, dimensions: PagesDimensions): Bitmap? {
    if (puffer.capacity() != dimensions.bytes) return null
    return createBitmap(dimensions.breite, dimensions.hoehe).also { it.copyPixelsFromBuffer(puffer) }
}

/** Die Seite der App: bindet den Dienst einmal und reicht Deskriptoren hinüber. */
@Singleton
internal class PdfRenderConnection @Inject constructor(@param:ApplicationContext private val ctx: Context) {
    private val lock = Mutex()
    @Volatile private var binder: IBinder? = null

    /** Seitenzahl; wirft, wenn das PDF nicht lesbar ist oder die Zahl nicht stimmen kann (der Lader lädt dann neu). */
    suspend fun seitenzahl(quelle: PdfQuelle): Int =
        call(PAGE_COUNT, quelle, {}, ::zahlen)?.singleOrNull()?.let(::checkPageCount) ?: throw IOException("PDF nicht lesbar")

    /**
     * Eine Seite in der Breite [widthPx]; null, wenn sie sich nicht rendern lässt. Der
     * Renderer nennt erst die Seitenkanten, dann füllt er einen Speicher fester Grösse.
     */
    suspend fun seite(quelle: PdfQuelle, index: Int, widthPx: Int): Bitmap? = fangeAusserAbbruch {
        val kanten = call(DIMENSIONS, quelle, { writeInt(index) }, ::zahlen)?.takeIf { it.size == 2 } ?: return null
        val dimensions = pagesDimensions(widthPx, kanten[0], kanten[1]) ?: return null
        SharedMemory.create("pdf-seite", dimensions.bytes).use { speicher ->
            val gerendert = call(PAGE, quelle, {
                writeInt(index); writeInt(dimensions.breite); writeInt(dimensions.hoehe); speicher.writeToParcel(this, 0)
            }, ::zahlen) != null
            if (!gerendert) return null
            val puffer = speicher.mapReadOnly()
            try {
                bitmapFromBuffer(puffer, dimensions)
            } finally {
                SharedMemory.unmap(puffer)
            }
        }
    }.getOrNull()

    /** Die Antwort des Renderers: Anzahl, dann so viele Zahlen; höchstens zwei, sonst gilt sie nicht. */
    private fun zahlen(r: Parcel): IntArray? {
        val n = r.readInt()
        if (n !in 0..2) return null
        return IntArray(n) { r.readInt() }
    }

    private suspend fun <T> call(code: Int, quelle: PdfQuelle, arguments: Parcel.() -> Unit, lies: (Parcel) -> T): T =
        lock.withLock {
            // Ein abgestürzter Renderer (etwa an einem bösartigen PDF) wird einmal neu gebunden.
            try {
                send(connected(), code, quelle, arguments, lies)
            } catch (_: DeadObjectException) {
                binder = null
                send(connected(), code, quelle, arguments, lies)
            }
        }

    private fun <T> send(b: IBinder, code: Int, quelle: PdfQuelle, arguments: Parcel.() -> Unit, lies: (Parcel) -> T): T {
        val daten = Parcel.obtain()
        val antwort = Parcel.obtain()
        try {
            quelle.oeffne().use { pfd ->
                daten.writeInterfaceToken(INTERFACE)
                daten.writeFileDescriptor(pfd.fileDescriptor)
                daten.arguments()
                if (!b.transact(code, daten, antwort, 0)) throw IOException("PDF-Renderer antwortet nicht")
            }
            return lies(antwort)
        } finally {
            daten.recycle()
            antwort.recycle()
        }
    }

    private suspend fun connected(): IBinder = binder?.takeIf { it.isBinderAlive } ?: connect().also { binder = it }

    private suspend fun connect(): IBinder = suspendCancellableCoroutine { continuation ->
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder) {
                // Nach einem Absturz verbindet das System von selbst neu.
                if (continuation.isActive) continuation.resume(service) else binder = service
            }
            override fun onServiceDisconnected(name: ComponentName?) { binder = null }
            override fun onNullBinding(name: ComponentName?) {
                if (continuation.isActive) continuation.resumeWithException(IOException("PDF-Renderer ohne Schnittstelle"))
            }
        }
        if (!ctx.bindService(Intent(ctx, PdfRenderDienst::class.java), connection, Context.BIND_AUTO_CREATE)) {
            continuation.resumeWithException(IOException("PDF-Renderer nicht erreichbar"))
        }
    }
}
