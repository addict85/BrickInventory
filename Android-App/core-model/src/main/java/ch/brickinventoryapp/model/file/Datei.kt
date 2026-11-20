package ch.brickinventoryapp.model.file

/**
 * Eine vom Nutzer gewählte Datei, wie die Oberfläche sie nennt (die Zeichenkette
 * einer content://-Adresse). Kein android.net.Uri: Das ViewModel reicht sie nur an
 * den [FileReader] weiter und bleibt so ohne Android-Typen prüfbar.
 */
@JvmInline
value class FileRef(val wert: String)

/** Was [FileReader.readAtMost] fand: Medientyp und Inhalt, oder eine zu grosse Datei. */
sealed interface Gelesen {
    class Inhalt(val typ: String?, val bytes: ByteArray) : Gelesen
    data object ToLarge : Gelesen
}

/** Liest eine vom Nutzer gewählte Datei: Medientyp und Inhalt, oder null. */
interface FileReader {
    suspend fun lies(datei: FileRef): Pair<String?, ByteArray>?

    /** Höchstens [grenze] Bytes; eine grössere Datei kommt nie ganz in den Speicher. null: nicht lesbar. */
    suspend fun readAtMost(datei: FileRef, grenze: Long): Gelesen? =
        lies(datei)?.let { (typ, bytes) -> if (bytes.size > grenze) Gelesen.ToLarge else Gelesen.Inhalt(typ, bytes) }
    /** Der angezeigte Dateiname, oder null, wenn ihn die Quelle nicht nennt. */
    suspend fun name(datei: FileRef): String? = null
}
