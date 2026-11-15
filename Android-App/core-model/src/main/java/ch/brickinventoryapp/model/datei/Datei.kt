package ch.brickinventoryapp.model.datei

/**
 * Eine vom Nutzer gewählte Datei, wie die Oberfläche sie nennt (die Zeichenkette
 * einer content://-Adresse). Kein android.net.Uri: Das ViewModel reicht sie nur an
 * den [DateiLeser] weiter und bleibt so ohne Android-Typen prüfbar.
 */
@JvmInline
value class DateiRef(val wert: String)

/** Was [DateiLeser.liesHoechstens] fand: Medientyp und Inhalt, oder eine zu grosse Datei. */
sealed interface Gelesen {
    class Inhalt(val typ: String?, val bytes: ByteArray) : Gelesen
    data object ZuGross : Gelesen
}

/** Liest eine vom Nutzer gewählte Datei: Medientyp und Inhalt, oder null. */
interface DateiLeser {
    suspend fun lies(datei: DateiRef): Pair<String?, ByteArray>?

    /** Höchstens [grenze] Bytes; eine grössere Datei kommt nie ganz in den Speicher. null: nicht lesbar. */
    suspend fun liesHoechstens(datei: DateiRef, grenze: Long): Gelesen? =
        lies(datei)?.let { (typ, bytes) -> if (bytes.size > grenze) Gelesen.ZuGross else Gelesen.Inhalt(typ, bytes) }
    /** Der angezeigte Dateiname, oder null, wenn ihn die Quelle nicht nennt. */
    suspend fun name(datei: DateiRef): String? = null
}
