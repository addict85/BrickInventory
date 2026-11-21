package ch.brickinventoryapp.model.domain

/** Where a figure in the stock comes from; the server writes „set“ or „manual“. */
enum class Herkunft(val kennung: String) {
    SET("set"),
    MANUELL("manual"),
    ;

    companion object {
        /** An unknown word counts as set: this way the card shows no purchases that do not exist. */
        fun aus(kennung: String?): Herkunft = entries.firstOrNull { it.kennung == kennung } ?: SET
    }
}
