package ch.brickinventoryapp.model.domain

/** Where a figure in the stock comes from; the server writes „set“ or „manual“. */
enum class Origin(val identifier: String) {
    SET("set"),
    MANUAL("manual"),
    ;

    companion object {
        /** An unknown word counts as set: this way the card shows no purchases that do not exist. */
        fun from(identifier: String?): Origin = entries.firstOrNull { it.identifier == identifier } ?: SET
    }
}
