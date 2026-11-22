package ch.brickinventoryapp.finances.ui.pdf

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
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
import ch.brickinventoryapp.model.ui.Fehlerklasse

/**
 * Where the viewer reads from. An interface, so that the ViewModel can be
 * checked without a device; [oeffne] renders the pages, printing and downloading read [inbox].
 */
interface PdfQuelle : Closeable {
    fun oeffne(): ParcelFileDescriptor
    fun inbox(): InputStream
}

/** How far the viewer has got; errors carry the cause's text or a [grund]. */
sealed class PdfLoadState {
    data class Downloading(val pct: Int, val bytes: Long, val total: Long) : PdfLoadState()
    data object Rendering : PdfLoadState()
    data class Ready(val quelle: PdfQuelle, val pageCount: Int) : PdfLoadState()
    /** [klasse] chooses heading and advice as everywhere in the app; [message] is at most an addition. */
    data class Error(
        val message: String?,
        val grund: PdfError = PdfError.UNBEKANNT,
        val klasse: Fehlerklasse? = null,
    ) : PdfLoadState()
}

/** What kind of error a failed download was; the exception's sentence is technical, not informative. */
internal fun pdfErrorClass(e: Throwable): Fehlerklasse {
    val status = (e as? DownloadFailed)?.status
    return when {
        status == 401 || status == 403 -> Fehlerklasse.LOGIN
        status != null && status >= 500 -> Fehlerklasse.SERVER
        status != null -> Fehlerklasse.UNBEKANNT
        e is UnknownHostException || e is SocketException || e is InterruptedIOException -> Fehlerklasse.OFFLINE
        else -> Fehlerklasse.UNBEKANNT
    }
}

/** Error without its own text; the UI chooses the sentence in the app's language. */
enum class PdfError { FREMDER_HOST, DOWNLOAD, UNBEKANNT }

/**
 * Holds the source for as long as the viewer stands. If it only arrives after leaving
 * (the download was still running), it is closed right away instead of living until the process ends.
 */
class PdfHolder : Closeable {
    private var quelle: PdfQuelle? = null
    private var zu = false

    @Synchronized
    fun hold(neu: PdfQuelle): Boolean {
        if (zu) {
            neu.close()
            return false
        }
        quelle?.close()
        quelle = neu
        return true
    }

    @Synchronized
    override fun close() {
        zu = true
        quelle?.close()
        quelle = null
    }
}

/**
 * An area without a name on disk. PdfRenderer needs a descriptor it can seek
 * within; but the plain text must never sit anywhere a file access could find it.
 * The area dies with [close] or at the latest with the process, even after a crash.
 * It only ever crosses over to the renderer immutable: sealed, or opened read-only.
 */
internal class PdfArea(private val bereich: ParcelFileDescriptor, private val openInbox: () -> InputStream) : PdfQuelle {
    // A descriptor of its own per access (PdfRenderer closes it along); all duplicates
    // share the read position, so they start at the front like a freshly opened file.
    override fun oeffne(): ParcelFileDescriptor =
        bereich.dup().also { Os.lseek(it.fileDescriptor, 0, OsConstants.SEEK_SET) }

    override fun inbox(): InputStream = openInbox()
    override fun close() = bereich.close()

    companion object {
        /** A voucher PDF (number and PIN): only in the memfd. */
        fun speicher(inhalt: ByteArray): PdfArea {
            val bereich = memfd()
            fangeAusserAbbruch {
                writeEverything(bereich.fileDescriptor, inhalt, inhalt.size)
                seal(bereich.fileDescriptor)
            }.onFailure { e ->
                bereich.close()
                throw e
            }
            return PdfArea(bereich) { ByteArrayInputStream(inhalt) }
        }

        /** An instruction manual from the encrypted store; large ones not into working memory ([INSTRUCTION_IN_STORAGE_UNTIL]). */
        fun anleitung(ablage: InstructionStore, datei: File, anzeige: File): PdfArea {
            val inStorage = datei.length() <= INSTRUCTION_IN_STORAGE_UNTIL
            val (schreiber, bereich) = if (inStorage) memfd().let { it to it } else nameless(anzeige)
            fangeAusserAbbruch {
                ablage.lies(datei).use { ein ->
                    val puffer = ByteArray(64 * 1024)
                    while (true) {
                        val n = ein.read(puffer)
                        if (n < 0) break
                        writeEverything(schreiber.fileDescriptor, puffer, n)
                    }
                }
                if (inStorage) seal(bereich.fileDescriptor) else schreiber.close()
            }.onFailure { e ->
                if (schreiber !== bereich) schreiber.close()
                bereich.close()
                throw e
            }
            return PdfArea(bereich) { ablage.lies(datei) }
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
            val datei = File.createTempFile("anzeige", ".pdf", folder)
            try {
                val schreiber = ParcelFileDescriptor.open(datei, ParcelFileDescriptor.MODE_WRITE_ONLY)
                val reader = fangeAusserAbbruch { ParcelFileDescriptor.open(datei, ParcelFileDescriptor.MODE_READ_ONLY) }
                    .getOrElse { schreiber.close(); throw it }
                return schreiber to reader
            } finally {
                datei.delete()
            }
        }

        private fun writeEverything(fd: FileDescriptor, daten: ByteArray, laenge: Int) {
            var geschrieben = 0
            while (geschrieben < laenge) geschrieben += Os.write(fd, daten, geschrieben, laenge - geschrieben)
        }
    }
}
