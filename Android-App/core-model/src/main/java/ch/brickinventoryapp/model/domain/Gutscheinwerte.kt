package ch.brickinventoryapp.model.domain

// What the voucher repository takes and delivers, in domain values instead of wire types.

/** A voucher as the form creates or changes it; [pin] null means none. */
data class Gutscheinangabe(val nummer: String, val pin: String?, val betrag: Geld, val waehrung: Waehrung)

/** What saving resulted in: saved (with numbers for a collective PDF) or read incompletely. */
sealed interface Gutscheinspeicherung {
    /** [neu] and [geaendert] only for a PDF with several cards. */
    data class Gespeichert(val neu: Int? = null, val geaendert: Int? = null) : Gutscheinspeicherung

    /** The server did not read the PDF completely; what it found prefills the form. */
    data class Incomplete(
        val nummer: String? = null,
        val pin: String? = null,
        val betrag: Geld? = null,
        val waehrung: Waehrung? = null,
    ) : Gutscheinspeicherung
}

/**
 * The response to a balance query. Without [erfolg] [grund] names the kind of refusal
 * („abstand“ with [wartenSek], „botschutz“, „konto“) and [fehler] the server's sentence.
 */
data class Guthabenauskunft(
    val erfolg: Boolean,
    val gutschein: VoucherView? = null,
    val angezeigt: String? = null,
    val waehrungGeaendert: Boolean = false,
    val grund: String? = null,
    val wartenSek: Int? = null,
    val fehler: String? = null,
)
