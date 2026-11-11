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

private const val SCHNITTSTELLE = "ch.brickinventoryapp.pdf.Renderer"
private const val SEITENZAHL = IBinder.FIRST_CALL_TRANSACTION
private const val SEITE = IBinder.FIRST_CALL_TRANSACTION + 1
private const val MASSE = IBinder.FIRST_CALL_TRANSACTION + 2
private const val FEHLT = -1

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
            if (code != SEITENZAHL && code != SEITE && code != MASSE) return super.onTransact(code, data, reply, flags)
            data.enforceInterface(SCHNITTSTELLE)
            val antwort = checkNotNull(reply)
            // PdfRenderer ist nicht thread-safe; Binder-Fäden kommen gleichzeitig.
            synchronized(this) {
                val pfd = data.readFileDescriptor()
                val ergebnis = fangeAusserAbbruch {
                    PdfRenderer(checkNotNull(pfd)).use { leser ->
                        when (code) {
                            SEITENZAHL -> intArrayOf(leser.pageCount)
                            MASSE -> masse(leser, data.readInt())
                            else -> seite(leser, data)
                        }
                    }
                }.getOrNull()
                runCatching { pfd?.close() }
                antwort.writeInt(ergebnis?.size ?: FEHLT)
                ergebnis?.forEach(antwort::writeInt)
            }
            return true
        }

        private fun masse(leser: PdfRenderer, index: Int): IntArray? {
            if (index !in 0 until leser.pageCount) return null
            return leser.openPage(index).use { intArrayOf(it.width, it.height) }
        }

        /** Rendert in die Masse des Hauptprozesses und kopiert die Pixel in dessen Speicher. */
        private fun seite(leser: PdfRenderer, data: Parcel): IntArray? {
            val index = data.readInt()
            val w = data.readInt()
            val h = data.readInt()
            SharedMemory.CREATOR.createFromParcel(data).use { speicher ->
                if (index !in 0 until leser.pageCount || w <= 0 || h <= 0 || speicher.size.toLong() != w.toLong() * h * 4) return null
                val bild = createBitmap(w, h)
                try {
                    bild.eraseColor(Color.WHITE)
                    leser.openPage(index).use { it.render(bild, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY) }
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
internal fun bitmapAusPuffer(puffer: ByteBuffer, masse: SeitenMasse): Bitmap? {
    if (puffer.capacity() != masse.bytes) return null
    return createBitmap(masse.breite, masse.hoehe).also { it.copyPixelsFromBuffer(puffer) }
}

/** Die Seite der App: bindet den Dienst einmal und reicht Deskriptoren hinüber. */
@Singleton
internal class PdfRenderVerbindung @Inject constructor(@param:ApplicationContext private val ctx: Context) {
    private val sperre = Mutex()
    @Volatile private var binder: IBinder? = null

    /** Seitenzahl; wirft, wenn das PDF nicht lesbar ist oder die Zahl nicht stimmen kann (der Lader lädt dann neu). */
    suspend fun seitenzahl(quelle: PdfQuelle): Int =
        rufe(SEITENZAHL, quelle, {}, ::zahlen)?.singleOrNull()?.let(::pruefeSeitenzahl) ?: throw IOException("PDF nicht lesbar")

    /**
     * Eine Seite in der Breite [breitePx]; null, wenn sie sich nicht rendern lässt. Der
     * Renderer nennt erst die Seitenkanten, dann füllt er einen Speicher fester Grösse.
     */
    suspend fun seite(quelle: PdfQuelle, index: Int, breitePx: Int): Bitmap? = fangeAusserAbbruch {
        val kanten = rufe(MASSE, quelle, { writeInt(index) }, ::zahlen)?.takeIf { it.size == 2 } ?: return null
        val masse = seitenMasse(breitePx, kanten[0], kanten[1]) ?: return null
        SharedMemory.create("pdf-seite", masse.bytes).use { speicher ->
            val gerendert = rufe(SEITE, quelle, {
                writeInt(index); writeInt(masse.breite); writeInt(masse.hoehe); speicher.writeToParcel(this, 0)
            }, ::zahlen) != null
            if (!gerendert) return null
            val puffer = speicher.mapReadOnly()
            try {
                bitmapAusPuffer(puffer, masse)
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
