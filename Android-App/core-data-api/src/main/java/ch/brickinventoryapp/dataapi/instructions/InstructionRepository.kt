package ch.brickinventoryapp.dataapi.instructions

import java.io.File
import java.io.IOException

/**
 * The download failed. [status]: the server answered, but not with the PDF; the
 * display then chooses the kind of error. Null means: no cause was left.
 */
class DownloadFailed(val status: Int? = null) : IOException(status?.let { "HTTP $it" })

/** The network of instructions and voucher PDFs; preparing and showing happens in the UI. */
interface InstructionRepository {
    /**
     * Loads [url] into [target], via a partial file and with resuming. [once]: the
     * address carries a ticket for exactly one fetch, so no second attempt.
     */
    suspend fun load(url: String, target: File, once: Boolean, progress: (loaded: Long, total: Long) -> Unit)

    /** A confidential PDF only into memory, without a partial file. */
    suspend fun loadInTheStorage(url: String, progress: (loaded: Long, total: Long) -> Unit): ByteArray
}
