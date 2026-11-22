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
import ch.brickinventoryapp.model.util.catchUnlessCancelled
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
 * PDFs come in content from third parties, pdfium is native code. Rendering therefore happens in
 * an isolated process (manifest: isolatedProcess) without permissions, files,
 * tokens or storage keys. It gets the descriptor read-only and writes pixels into
 * a buffer whose size the main process sets; it returns no objects.
 */
internal class PdfRenderService : Service() {
    override fun onBind(intent: Intent?): IBinder = Renderer()

    private class Renderer : Binder() {
        override fun onTransact(code: Int, data: Parcel, reply: Parcel?, flags: Int): Boolean {
            if (code != PAGE_COUNT && code != PAGE && code != DIMENSIONS) return super.onTransact(code, data, reply, flags)
            data.enforceInterface(INTERFACE)
            val response = checkNotNull(reply)
            // PdfRenderer is not thread-safe; binder threads arrive concurrently.
            synchronized(this) {
                val pfd = data.readFileDescriptor()
                val outcome = catchUnlessCancelled {
                    PdfRenderer(checkNotNull(pfd)).use { reader ->
                        when (code) {
                            PAGE_COUNT -> intArrayOf(reader.pageCount)
                            DIMENSIONS -> dimensions(reader, data.readInt())
                            else -> page(reader, data)
                        }
                    }
                }.getOrNull()
                runCatching { pfd?.close() }
                response.writeInt(outcome?.size ?: MISSING)
                outcome?.forEach(response::writeInt)
            }
            return true
        }

        private fun dimensions(reader: PdfRenderer, index: Int): IntArray? {
            if (index !in 0 until reader.pageCount) return null
            return reader.openPage(index).use { intArrayOf(it.width, it.height) }
        }

        /** Renders at the main process's dimensions and copies the pixels into its buffer. */
        private fun page(reader: PdfRenderer, data: Parcel): IntArray? {
            val index = data.readInt()
            val w = data.readInt()
            val h = data.readInt()
            SharedMemory.CREATOR.createFromParcel(data).use { memory ->
                if (index !in 0 until reader.pageCount || w <= 0 || h <= 0 || memory.size.toLong() != w.toLong() * h * 4) return null
                val image = createBitmap(w, h)
                try {
                    image.eraseColor(Color.WHITE)
                    reader.openPage(index).use { it.render(image, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY) }
                    val buffer = memory.mapReadWrite()
                    try {
                        image.copyPixelsToBuffer(buffer)
                    } finally {
                        SharedMemory.unmap(buffer)
                    }
                } finally {
                    image.recycle()
                }
            }
            return intArrayOf()
        }
    }
}

/**
 * Builds the page in the main process from the shared memory: dimensions and format come
 * from here, only pixels come from the renderer. Null if the buffer does not fit exactly.
 */
internal fun bitmapFromBuffer(buffer: ByteBuffer, dimensions: PagesDimensions): Bitmap? {
    if (buffer.capacity() != dimensions.bytes) return null
    return createBitmap(dimensions.width, dimensions.height).also { it.copyPixelsFromBuffer(buffer) }
}

/** The app's side: binds the service once and hands descriptors across. */
@Singleton
internal class PdfRenderConnection @Inject constructor(@param:ApplicationContext private val ctx: Context) {
    private val lock = Mutex()
    @Volatile private var binder: IBinder? = null

    /** Page count; throws if the PDF is not readable or the number cannot be right (the loader then reloads). */
    suspend fun pageCount(source: PdfSource): Int =
        call(PAGE_COUNT, source, {}, ::numbers)?.singleOrNull()?.let(::checkPageCount) ?: throw IOException("PDF nicht lesbar")

    /**
     * A page at width [widthPx]; null if it cannot be rendered. The
     * renderer first states the page edges, then fills a buffer of fixed size.
     */
    suspend fun page(source: PdfSource, index: Int, widthPx: Int): Bitmap? = catchUnlessCancelled {
        val edges = call(DIMENSIONS, source, { writeInt(index) }, ::numbers)?.takeIf { it.size == 2 } ?: return null
        val dimensions = pagesDimensions(widthPx, edges[0], edges[1]) ?: return null
        SharedMemory.create("pdf-seite", dimensions.bytes).use { memory ->
            val rendered = call(PAGE, source, {
                writeInt(index); writeInt(dimensions.width); writeInt(dimensions.height); memory.writeToParcel(this, 0)
            }, ::numbers) != null
            if (!rendered) return null
            val buffer = memory.mapReadOnly()
            try {
                bitmapFromBuffer(buffer, dimensions)
            } finally {
                SharedMemory.unmap(buffer)
            }
        }
    }.getOrNull()

    /** The renderer's answer: a count, then that many numbers; at most two, otherwise it does not count. */
    private fun numbers(r: Parcel): IntArray? {
        val n = r.readInt()
        if (n !in 0..2) return null
        return IntArray(n) { r.readInt() }
    }

    private suspend fun <T> call(code: Int, source: PdfSource, arguments: Parcel.() -> Unit, read: (Parcel) -> T): T =
        lock.withLock {
            // A crashed renderer (say, from a malicious PDF) is rebound once.
            try {
                send(connected(), code, source, arguments, read)
            } catch (_: DeadObjectException) {
                binder = null
                send(connected(), code, source, arguments, read)
            }
        }

    private fun <T> send(b: IBinder, code: Int, source: PdfSource, arguments: Parcel.() -> Unit, read: (Parcel) -> T): T {
        val data = Parcel.obtain()
        val response = Parcel.obtain()
        try {
            source.open().use { pfd ->
                data.writeInterfaceToken(INTERFACE)
                data.writeFileDescriptor(pfd.fileDescriptor)
                data.arguments()
                if (!b.transact(code, data, response, 0)) throw IOException("PDF-Renderer antwortet nicht")
            }
            return read(response)
        } finally {
            data.recycle()
            response.recycle()
        }
    }

    private suspend fun connected(): IBinder = binder?.takeIf { it.isBinderAlive } ?: connect().also { binder = it }

    private suspend fun connect(): IBinder = suspendCancellableCoroutine { continuation ->
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName?, service: IBinder) {
                // After a crash the system reconnects on its own.
                if (continuation.isActive) continuation.resume(service) else binder = service
            }
            override fun onServiceDisconnected(name: ComponentName?) { binder = null }
            override fun onNullBinding(name: ComponentName?) {
                if (continuation.isActive) continuation.resumeWithException(IOException("PDF-Renderer ohne Schnittstelle"))
            }
        }
        if (!ctx.bindService(Intent(ctx, PdfRenderService::class.java), connection, Context.BIND_AUTO_CREATE)) {
            continuation.resumeWithException(IOException("PDF-Renderer nicht erreichbar"))
        }
    }
}
