package ch.brickinventoryapp.model.file

/**
 * A file chosen by the user, as the UI names it (the string
 * of a content:// address). No android.net.Uri: the ViewModel only passes it on to
 * the [FileReader] and thus stays testable without Android types.
 */
@JvmInline
value class FileRef(val wert: String)

/** What [FileReader.readAtMost] found: media type and content, or a file that is too large. */
sealed interface Gelesen {
    class Inhalt(val typ: String?, val bytes: ByteArray) : Gelesen
    data object ToLarge : Gelesen
}

/** Reads a file chosen by the user: media type and content, or null. */
interface FileReader {
    suspend fun lies(datei: FileRef): Pair<String?, ByteArray>?

    /** At most [grenze] bytes; a larger file never comes into memory completely. null: not readable. */
    suspend fun readAtMost(datei: FileRef, grenze: Long): Gelesen? =
        lies(datei)?.let { (typ, bytes) -> if (bytes.size > grenze) Gelesen.ToLarge else Gelesen.Inhalt(typ, bytes) }
    /** The displayed file name, or null if the source does not name it. */
    suspend fun name(datei: FileRef): String? = null
}
