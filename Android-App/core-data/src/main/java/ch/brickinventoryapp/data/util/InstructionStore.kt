package ch.brickinventoryapp.data.util

import okio.FileSystem
import okio.Path.Companion.toOkioPath
import okio.blackholeSink
import okio.buffer
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import javax.inject.Inject
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.Ablageschluessel
import ch.brickinventoryapp.security.EncryptedFileSystem

/** Name prefix of the instructions in the cache ([pdfAblage]); `.part` after it means: download running. */
internal const val INSTRUCTION_PREFIX = "anleitung_"
internal const val INSTRUCTION_EXTENSION = ".bin"

/** Here the display files of large instructions arise, their name is deleted immediately (ui/pdf/PdfQuelle.kt). */
const val INSTRUCTION_DISPLAY_FOLDER = "anleitung_anzeige"

/**
 * Up to this size the viewer decrypts an instruction into a memfd. Above it
 * the area occupied the app's RAM (up to 300 MB) and made it the first
 * victim of the low-memory killer; then a file whose name is gone before the first byte.
 */
const val INSTRUCTION_IN_STORAGE_UNTIL: Long = 64L * 1024 * 1024

/**
 * Building instructions in the cache, encrypted like the image cache: they name set number
 * and title, i.e. the collection. Every file is bound to its name (SHA-256 of the
 * address), a partial file can be resumed, a truncated one does not count.
 */
class InstructionStore(cipher: StoreCipher) {
    @Inject constructor(ablage: Ablageschluessel) : this(StoreCipher { ablage.fuer(PURPOSE) })

    private val fs = EncryptedFileSystem(FileSystem.SYSTEM, cipher, PURPOSE)

    /** Plaintext bytes of a partial file, i.e. the resume point. An unreadable one is discarded. */
    fun plaintextLength(datei: File): Long {
        if (!datei.isFile) return 0L
        return try {
            fs.source(datei.toOkioPath()).buffer().use { it.readAll(blackholeSink()) }
        } catch (_: IOException) {
            datei.delete()
            0L
        }
    }

    /** New or appending; only `close` finishes with the end marker. */
    fun schreibe(datei: File, resume: Boolean): OutputStream {
        val pfad = datei.toOkioPath()
        return (if (resume) fs.appendingSink(pfad) else fs.sink(pfad)).buffer().outputStream()
    }

    /** Decrypts while reading; throws IOException if the file was changed or truncated. */
    fun lies(datei: File): InputStream = fs.source(datei.toOkioPath()).buffer().inputStream()

    private companion object {
        const val PURPOSE = "anleitungen"
    }
}

/** On sign-out and thus on server switch: the instructions belong to the account's collection. */
fun raeumeAnleitungenAuf(cacheDir: File) {
    raeumeKlartextAnleitungenAuf(cacheDir)
    cacheDir.listFiles { f -> f.name.startsWith(INSTRUCTION_PREFIX) }?.forEach { it.deleteRecursively() }
}

/** At start: plaintext instructions of older versions (`pdfview_*`) and display remnants of a crash. */
fun raeumeKlartextAnleitungenAuf(cacheDir: File) {
    cacheDir.listFiles { f -> f.name.startsWith("pdfview_") }?.forEach { it.delete() }
    File(cacheDir, INSTRUCTION_DISPLAY_FOLDER).deleteRecursively()
}
