package ch.brickinventoryapp.model.fach


// Was das Gutschein-Repository nimmt und liefert, in Fachwerten statt Wire-Typen.

/** Ein Gutschein, wie ihn das Formular anlegt oder ändert; [pin] null heisst keine. */
data class Gutscheinangabe(val nummer: String, val pin: String?, val betrag: Double, val waehrung: Waehrung)

/** Was das Speichern ergab: gespeichert (bei einer Sammel-PDF mit Zahlen) oder unvollständig gelesen. */
sealed interface Gutscheinspeicherung {
    /** [neu] und [geaendert] nur bei einer PDF mit mehreren Karten. */
    data class Gespeichert(val neu: Int? = null, val geaendert: Int? = null) : Gutscheinspeicherung

    /** Der Server las die PDF nicht ganz; was er fand, belegt das Formular vor. */
    data class Unvollstaendig(
        val nummer: String? = null,
        val pin: String? = null,
        val betrag: Double? = null,
        val waehrung: Waehrung? = null,
    ) : Gutscheinspeicherung
}

/**
 * Die Antwort auf eine Guthabenabfrage. Ohne [erfolg] nennt [grund] die Art der Absage
 * („abstand“ mit [wartenSek], „botschutz“, „konto“) und [fehler] den Satz des Servers.
 */
data class Guthabenauskunft(
    val erfolg: Boolean,
    val gutschein: GutscheinAnsicht? = null,
    val angezeigt: String? = null,
    val waehrungGeaendert: Boolean = false,
    val grund: String? = null,
    val wartenSek: Int? = null,
    val fehler: String? = null,
)
