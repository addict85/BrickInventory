package ch.brickinventoryapp.model.file

/**
 * A file chosen by the user, as the UI names it (the string
 * of a content:// address). No android.net.Uri: the ViewModel only passes it on to
 * the [FileReader] and thus stays testable without Android types.
 */
@JvmInline
value class FileRef(val value: String)

/** What [FileReader.readAtMost] found: media type and content, or a file that is too large. */
sealed interface Read {
    class Content(val type: String?, val bytes: ByteArray) : Read
    data object ToLarge : Read
}

/** Reads a file chosen by the user: media type and content, or null. */
interface FileReader {
    suspend fun read(file: FileRef): Pair<String?, ByteArray>?

    /** At most [limit] bytes; a larger file never comes into memory completely. null: not readable. */
    suspend fun readAtMost(file: FileRef, limit: Long): Read? =
        read(file)?.let { (type, bytes) -> if (bytes.size > limit) Read.ToLarge else Read.Content(type, bytes) }
    /** The displayed file name, or null if the source does not name it. */
    suspend fun name(file: FileRef): String? = null
}
