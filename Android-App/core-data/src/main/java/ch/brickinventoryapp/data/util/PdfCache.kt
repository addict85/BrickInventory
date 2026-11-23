package ch.brickinventoryapp.data.util

import java.io.File

/**
 * What to do next with a cached instruction.
 * The state depends on the file name: a download writes to `<name>.part` and is only renamed
 * at the end, so `<name>` present means = complete.
 */
internal sealed class PdfStep {
    /** The file is completely there. Fetch nothing. */
    object Done : PdfStep()

    /**
     * Fetch from this byte. `ab == 0` means „from the start, without a Range header" —
     * a `Range: bytes=0-` would be valid, but it asks for a
     * partial piece and would get 206 instead of 200. For the first attempt the
     * plain request is the right one.
     */
    data class Fetch(val ab: Long) : PdfStep()
}

/**
 * @param finishedSize size of the finished file, 0 if it does not exist.
 * @param partSize    size of the partial file, 0 if it does not exist.
 */
internal fun pdfStep(finishedSize: Long, partSize: Long): PdfStep = when {
    // The finished file beats everything. If a partial file still lies next to it,
    // it is a leftover and gets disposed of at the next cleanup.
    finishedSize > 0L -> PdfStep.Done
    partSize > 0L    -> PdfStep.Fetch(partSize)
    else                -> PdfStep.Fetch(0L)
}

/** Folder in which older versions stored voucher PDFs; only kept for cleaning up. */
const val PDF_CONFIDENTIAL_FOLDER = "pdf_vertraulich"

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

/** Delete voucher PDFs of older versions: at start and at sign-out. */
fun cleanUpConfidentialPdfs(cacheDir: File) {
    File(cacheDir, PDF_CONFIDENTIAL_FOLDER).deleteRecursively()
}

/**
 * Where the parts list goes: it carries the inventory, so into filesDir. Copies
 * of older versions (externally readable below Android 8/9, internally in plaintext) are
 * removed in the process.
 */
internal fun partListsStore(intern: File, extern: File?): File {
    extern?.let { File(it, "pdf/teileliste.pdf").delete() }
    val folder = File(intern, "pdf").apply { mkdirs() }
    File(folder, "teileliste.pdf").delete()
    return File(folder, PART_LIST_FILE)
}

/**
 * How long the parts list stays: the notification „done, tap“ opens it
 * later still. It is encrypted then too, but the inventory should not lie on the
 * device longer than someone needs it.
 */
const val PART_LIST_DEADLINE_MS: Long = 30L * 60 * 1000

/** Deletes the parts list if it is older than [deadline]; at start and in the job after the export. */
fun cleanOldPartListOn(intern: File, now: Long, deadline: Long = PART_LIST_DEADLINE_MS): Boolean {
    File(File(intern, "pdf"), "teileliste.pdf").delete()
    val file = File(File(intern, "pdf"), PART_LIST_FILE)
    return file.isFile && now - file.lastModified() >= deadline && file.delete()
}

/**
 * Where the loaded APK goes; installation happens via a PackageInstaller session, without FileProvider.
 * Here and public because core-update loads there and sign-out (below) clears it.
 */
const val UPDATE_FOLDER = "update"

/**
 * At sign-out: parts list (inventory) and shared PDFs in both roots, plus a
 * loaded update. The cache alone was not enough — filesDir survives sign-out,
 * and the next user on the device would otherwise open the previous one's inventory.
 */
fun cleanUpAccountFiles(intern: File, extern: File?) {
    File(intern, "pdf").deleteRecursively()
    File(intern, UPDATE_FOLDER).deleteRecursively()
    extern?.let { File(it, "pdf").deleteRecursively() }
}
