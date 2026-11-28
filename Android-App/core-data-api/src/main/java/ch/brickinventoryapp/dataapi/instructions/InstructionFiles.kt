package ch.brickinventoryapp.dataapi.instructions

import java.io.File
import java.io.InputStream
import java.io.OutputStream

/** Name prefix of the instructions in the cache ([pdfStore]); `.part` after it means: download running. */
const val INSTRUCTION_PREFIX = "anleitung_"
const val INSTRUCTION_EXTENSION = ".bin"

/** Here the display files of large instructions arise, their name is deleted immediately (ui/pdf/PdfSource.kt). */
const val INSTRUCTION_DISPLAY_FOLDER = "anleitung_anzeige"

/**
 * Up to this size the viewer decrypts an instruction into a memfd. Above it
 * the area occupied the app's RAM (up to 300 MB) and made it the first
 * victim of the low-memory killer; then a file whose name is gone before the first byte.
 */
const val INSTRUCTION_IN_STORAGE_UNTIL: Long = 64L * 1024 * 1024

/**
 * Building instructions on disk, as the viewer reads them: encrypted and bound to their name.
 * An interface so the viewer does not know the store key behind it.
 */
interface InstructionFiles {
    /** Plaintext bytes of a partial file, i.e. the resume point. An unreadable one is discarded. */
    fun plaintextLength(file: File): Long

    /** New or appending; only `close` finishes with the end marker. */
    fun write(file: File, resume: Boolean): OutputStream

    /** Decrypts while reading; throws IOException if the file was changed or truncated. */
    fun read(file: File): InputStream
}

/**
 * Where the viewer stores a PDF: instructions encrypted in the cache
 * ([InstructionStore]). A confidential PDF gets no file (null) and stays in
 * memory ([loadPdfIntoMemory]). The name is SHA-256 of the address: with 32 bits
 * (hashCode) two addresses would easily share a file.
 */
fun pdfStore(cacheDir: File, pdfUrl: String, confidential: Boolean): File? {
    if (confidential) return null
    val hash = java.security.MessageDigest.getInstance("SHA-256").digest(pdfUrl.toByteArray())
    return File(cacheDir, INSTRUCTION_PREFIX + hash.joinToString("") { "%02x".format(it) } + INSTRUCTION_EXTENSION)
}
