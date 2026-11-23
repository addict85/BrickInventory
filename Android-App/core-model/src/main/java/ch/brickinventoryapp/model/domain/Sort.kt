package ch.brickinventoryapp.model.domain

/**
 * The sort orders of the lists, one type per list: the server keeps one table each
 * (SET_SORTS, MERK_SORTS, catalog), and a value of one does not apply in the other.
 * On the wire and in the store stands the [SetSort.identifier]; unknown
 * reads as the default, the way the server treats an unknown value.
 */

enum class SetSort(val identifier: String) {
    NEWEST("added_desc"),
    OLDEST("added_asc"),
    NAME("name_asc"),
    NUMBER("num_asc"),
    YEAR("year_desc"),
    PRICE_DESCENDING("price_desc"),
    PRICE_ASCENDING("price_asc"),
    QUANTITY_DESCENDING("qty_desc"),
    QUANTITY_ASCENDING("qty_asc");

    companion object {
        val DEFAULT = NEWEST
        fun from(identifier: String?): SetSort = entries.firstOrNull { it.identifier == identifier } ?: DEFAULT
    }
}

/** The sort orders of the wishlist (MERK_SORTS): without quantity, the price is the market price. */
enum class WantedSort(val identifier: String) {
    NEWEST("added_desc"),
    OLDEST("added_asc"),
    NAME("name_asc"),
    NUMBER("num_asc"),
    YEAR("year_desc"),
    PRICE_DESCENDING("price_desc"),
    PRICE_ASCENDING("price_asc");

    companion object {
        val DEFAULT = NEWEST
        fun from(identifier: String?): WantedSort = entries.firstOrNull { it.identifier == identifier } ?: DEFAULT
    }
}

/** The sort orders of the catalog; sorted by year it shows the year bar. */
enum class CatalogSort(val identifier: String, val afterYear: Boolean = false) {
    YEAR_DESCENDING("year_desc", afterYear = true),
    YEAR_ASCENDING("year_asc", afterYear = true),
    NAME("name_asc"),
    NUMBER("num_asc"),
    PARTS_DESCENDING("parts_desc"),
    PARTS_ASCENDING("parts_asc");

    companion object {
        val DEFAULT = YEAR_DESCENDING
        fun from(identifier: String?): CatalogSort = entries.firstOrNull { it.identifier == identifier } ?: DEFAULT
    }
}

/**
 * The orders of the minifigures. Sorting happens in the app: the server delivers the
 * figures completely and by name, it knows no choice. NAME is its order.
 */
enum class FigureOrder {
    NAME, NUMBER, QUANTITY;

    fun sort(figures: List<FigureView>): List<FigureView> = when (this) {
        NAME -> figures
        NUMBER -> figures.sortedBy { it.figNumber.lowercase() }
        QUANTITY -> figures.sortedByDescending { it.totalQuantity ?: it.quantity }
    }

    companion object {
        val DEFAULT = NAME
    }
}
