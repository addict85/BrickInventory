package ch.brickinventoryapp.data.util

import ch.brickinventoryapp.dataapi.instructions.INSTRUCTION_DISPLAY_FOLDER
import ch.brickinventoryapp.dataapi.instructions.INSTRUCTION_PREFIX
import ch.brickinventoryapp.dataapi.instructions.InstructionFiles
import ch.brickinventoryapp.security.EncryptedFileSystem
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.StoreKey
import okio.FileSystem
import okio.Path.Companion.toOkioPath
import okio.blackholeSink
import okio.buffer
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import javax.inject.Inject

/**
 * Building instructions in the cache, encrypted like the image cache: they name set number
 * and title, i.e. the collection. Every file is bound to its name (SHA-256 of the
 * address), a partial file can be resumed, a truncated one does not count.
 */
class InstructionStore(cipher: StoreCipher) : InstructionFiles {
    @Inject constructor(store: StoreKey) : this(StoreCipher { store.forTarget(PURPOSE) })

    private val fs = EncryptedFileSystem(FileSystem.SYSTEM, cipher, PURPOSE)

    /** Plaintext bytes of a partial file, i.e. the resume point. An unreadable one is discarded. */
    override fun plaintextLength(file: File): Long {
        if (!file.isFile) return 0L
        return try {
            fs.source(file.toOkioPath()).buffer().use { it.readAll(blackholeSink()) }
        } catch (_: IOException) {
            file.delete()
            0L
        }
    }

    /** New or appending; only `close` finishes with the end marker. */
    override fun write(file: File, resume: Boolean): OutputStream {
        val path = file.toOkioPath()
        return (if (resume) fs.appendingSink(path) else fs.sink(path)).buffer().outputStream()
    }

    /** Decrypts while reading; throws IOException if the file was changed or truncated. */
    override fun read(file: File): InputStream = fs.source(file.toOkioPath()).buffer().inputStream()

    private companion object {
        const val PURPOSE = "anleitungen"
    }
}

/** On sign-out and thus on server switch: the instructions belong to the account's collection. */
internal fun cleanUpInstructions(cacheDir: File) {
    cleanUpPlaintextInstructions(cacheDir)
    cacheDir.listFiles { f -> f.name.startsWith(INSTRUCTION_PREFIX) }?.forEach { it.deleteRecursively() }
}

/** At start: plaintext instructions of older versions (`pdfview_*`) and display remnants of a crash. */
fun cleanUpPlaintextInstructions(cacheDir: File) {
    cacheDir.listFiles { f -> f.name.startsWith("pdfview_") }?.forEach { it.delete() }
    File(cacheDir, INSTRUCTION_DISPLAY_FOLDER).deleteRecursively()
}
