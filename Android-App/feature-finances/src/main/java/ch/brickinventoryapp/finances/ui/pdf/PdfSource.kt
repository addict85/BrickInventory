package ch.brickinventoryapp.finances.ui.pdf

import ch.brickinventoryapp.model.util.catchUnlessCancelled
import android.os.ParcelFileDescriptor
import android.system.Os
import android.system.OsConstants
import ch.brickinventoryapp.data.util.INSTRUCTION_IN_STORAGE_UNTIL
import ch.brickinventoryapp.data.util.InstructionStore
import java.io.ByteArrayInputStream
import java.io.Closeable
import java.io.File
import java.io.FileDescriptor
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.SocketException
import java.net.UnknownHostException
import ch.brickinventoryapp.data.DownloadFailed
import ch.brickinventoryapp.model.ui.ErrorClass

/**
 * Where the viewer reads from. An interface, so that the ViewModel can be
 * checked without a device; [open] renders the pages, printing and downloading read [inbox].
 */
interface PdfSource : Closeable {
    fun open(): ParcelFileDescriptor
    fun inbox(): InputStream
}

/** How far the viewer has got; errors carry the cause's text or a [reason]. */
sealed class PdfLoadState {
    data class Downloading(val pct: Int, val bytes: Long, val total: Long) : PdfLoadState()
    data object Rendering : PdfLoadState()
    data class Ready(val source: PdfSource, val pageCount: Int) : PdfLoadState()
    /** [kind] chooses heading and advice as everywhere in the app; [message] is at most an addition. */
    data class Error(
        val message: String?,
        val reason: PdfError = PdfError.UNKNOWN,
        val kind: ErrorClass? = null,
    ) : PdfLoadState()
}

/** What kind of error a failed download was; the exception's sentence is technical, not informative. */
internal fun pdfErrorClass(e: Throwable): ErrorClass {
    val status = (e as? DownloadFailed)?.status
    return when {
        status == 401 || status == 403 -> ErrorClass.LOGIN
        status != null && status >= 500 -> ErrorClass.SERVER
        status != null -> ErrorClass.UNKNOWN
        e is UnknownHostException || e is SocketException || e is InterruptedIOException -> ErrorClass.OFFLINE
        else -> ErrorClass.UNKNOWN
    }
}

/** Error without its own text; the UI chooses the sentence in the app's language. */
enum class PdfError { FOREIGN_HOST, DOWNLOAD, UNKNOWN }

/**
 * Holds the source for as long as the viewer stands. If it only arrives after leaving
 * (the download was still running), it is closed right away instead of living until the process ends.
 */
class PdfHolder : Closeable {
    private var source: PdfSource? = null
    private var too = false

    @Synchronized
    fun hold(newValue: PdfSource): Boolean {
        if (too) {
            newValue.close()
            return false
        }
        source?.close()
        source = newValue
        return true
    }

    @Synchronized
    override fun close() {
        too = true
        source?.close()
        source = null
    }
}

/**
 * An area without a name on disk. PdfRenderer needs a descriptor it can seek
 * within; but the plain text must never sit anywhere a file access could find it.
 * The area dies with [close] or at the latest with the process, even after a crash.
 * It only ever crosses over to the renderer immutable: sealed, or opened read-only.
 */
internal class PdfArea(private val area: ParcelFileDescriptor, private val openInbox: () -> InputStream) : PdfSource {
    // A descriptor of its own per access (PdfRenderer closes it along); all duplicates
    // share the read position, so they start at the front like a freshly opened file.
    override fun open(): ParcelFileDescriptor =
        area.dup().also { Os.lseek(it.fileDescriptor, 0, OsConstants.SEEK_SET) }

    override fun inbox(): InputStream = openInbox()
    override fun close() = area.close()

    companion object {
        /** A voucher PDF (number and PIN): only in the memfd. */
        fun memory(content: ByteArray): PdfArea {
            val area = memfd()
            catchUnlessCancelled {
                writeEverything(area.fileDescriptor, content, content.size)
                seal(area.fileDescriptor)
            }.onFailure { e ->
                area.close()
                throw e
            }
            return PdfArea(area) { ByteArrayInputStream(content) }
        }

        /** An instruction manual from the encrypted store; large ones not into working memory ([INSTRUCTION_IN_STORAGE_UNTIL]). */
        fun instruction(store: InstructionStore, file: File, display: File): PdfArea {
            val inStorage = file.length() <= INSTRUCTION_IN_STORAGE_UNTIL
            val (writer, area) = if (inStorage) memfd().let { it to it } else nameless(display)
            catchUnlessCancelled {
                store.read(file).use { one ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = one.read(buffer)
                        if (n < 0) break
                        writeEverything(writer.fileDescriptor, buffer, n)
                    }
                }
                if (inStorage) seal(area.fileDescriptor) else writer.close()
            }.onFailure { e ->
                if (writer !== area) writer.close()
                area.close()
                throw e
            }
            return PdfArea(area) { store.read(file) }
        }

        private fun memfd(): ParcelFileDescriptor {
            val fd = Os.memfd_create("pdf", MFD_ALLOW_SEALING)
            try {
                return ParcelFileDescriptor.dup(fd)
            } finally {
                Os.close(fd)
            }
        }

        // Linux constants (uapi/linux/fcntl.h, memfd.h); OsConstants does not expose them publicly.
        private const val MFD_ALLOW_SEALING = 2
        private const val F_ADD_SEALS = 1033
        private const val F_SEAL_SEAL = 1
        private const val F_SEAL_SHRINK = 2
        private const val F_SEAL_GROW = 4
        private const val F_SEAL_WRITE = 8

        /** After filling: nobody, not even the renderer with its duplicate, changes the content anymore. */
        private fun seal(fd: FileDescriptor) {
            Os.fcntlInt(fd, F_ADD_SEALS, F_SEAL_WRITE or F_SEAL_SHRINK or F_SEAL_GROW or F_SEAL_SEAL)
        }

        // The name is deleted before a single byte of plain text goes in; what remains is reachable
        // only through the open descriptors. A crash in between leaves behind an empty file.
        // One descriptor is for writing and closes again right away; only the reading one goes to the renderer.
        private fun nameless(folder: File): Pair<ParcelFileDescriptor, ParcelFileDescriptor> {
            folder.mkdirs()
            val file = File.createTempFile("anzeige", ".pdf", folder)
            try {
                val writer = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_WRITE_ONLY)
                val reader = catchUnlessCancelled { ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY) }
                    .getOrElse { writer.close(); throw it }
                return writer to reader
            } finally {
                file.delete()
            }
        }

        private fun writeEverything(fd: FileDescriptor, data: ByteArray, length: Int) {
            var written = 0
            while (written < length) written += Os.write(fd, data, written, length - written)
        }
    }
}
