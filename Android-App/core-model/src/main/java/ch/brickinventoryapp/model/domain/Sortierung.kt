package ch.brickinventoryapp.model.domain

/**
 * The sort orders of the lists, one type per list: the server keeps one table each
 * (SET_SORTS, MERK_SORTS, catalog), and a value of one does not apply in the other.
 * On the wire and in the store stands the [Setsortierung.kennung]; unknown
 * reads as the default, the way the server treats an unknown value.
 */

enum class Setsortierung(val kennung: String) {
    NEUESTE("added_desc"),
    AELTESTE("added_asc"),
    NAME("name_asc"),
    NUMMER("num_asc"),
    JAHR("year_desc"),
    PREIS_ABSTEIGEND("price_desc"),
    PREIS_AUFSTEIGEND("price_asc"),
    MENGE_ABSTEIGEND("qty_desc"),
    MENGE_AUFSTEIGEND("qty_asc");

    companion object {
        val DEFAULT = NEUESTE
        fun aus(kennung: String?): Setsortierung = entries.firstOrNull { it.kennung == kennung } ?: DEFAULT
    }
}

/** The sort orders of the wishlist (MERK_SORTS): without quantity, the price is the market price. */
enum class Merksortierung(val kennung: String) {
    NEUESTE("added_desc"),
    AELTESTE("added_asc"),
    NAME("name_asc"),
    NUMMER("num_asc"),
    JAHR("year_desc"),
    PREIS_ABSTEIGEND("price_desc"),
    PREIS_AUFSTEIGEND("price_asc");

    companion object {
        val DEFAULT = NEUESTE
        fun aus(kennung: String?): Merksortierung = entries.firstOrNull { it.kennung == kennung } ?: DEFAULT
    }
}

/** The sort orders of the catalog; sorted by year it shows the year bar. */
enum class Katalogsortierung(val kennung: String, val afterYear: Boolean = false) {
    JAHR_ABSTEIGEND("year_desc", afterYear = true),
    JAHR_AUFSTEIGEND("year_asc", afterYear = true),
    NAME("name_asc"),
    NUMMER("num_asc"),
    TEILE_ABSTEIGEND("parts_desc"),
    TEILE_AUFSTEIGEND("parts_asc");

    companion object {
        val DEFAULT = JAHR_ABSTEIGEND
        fun aus(kennung: String?): Katalogsortierung = entries.firstOrNull { it.kennung == kennung } ?: DEFAULT
    }
}

/**
 * The orders of the minifigures. Sorting happens in the app: the server delivers the
 * figures completely and by name, it knows no choice. NAME is its order.
 */
enum class Figurenordnung {
    NAME, NUMMER, QUANTITY;

    fun sort(figuren: List<FigurAnsicht>): List<FigurAnsicht> = when (this) {
        NAME -> figuren
        NUMMER -> figuren.sortedBy { it.figNumber.lowercase() }
        QUANTITY -> figuren.sortedByDescending { it.totalQuantity ?: it.quantity }
    }

    companion object {
        val DEFAULT = NAME
    }
}
