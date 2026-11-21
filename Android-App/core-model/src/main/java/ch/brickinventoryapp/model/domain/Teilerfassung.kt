package ch.brickinventoryapp.model.domain

/**
 * A part as the add dialog collects it. Named fields instead of nine values
 * by position: color name and color code are both `String?` and could be swapped
 * unnoticed. [KEINE_FARBE] means „without color“ as at the server, 0 would be black.
 */
data class Teilerfassung(
    val nummer: String,
    val farbId: Int = KEINE_FARBE,
    val farbname: String? = null,
    val farbHex: String? = null,
    val menge: Int = 1,
    val stueckpreis: Geld? = null,
    val zustand: Zustand? = null,
    val besitzer: Int? = null,
    val lagerort: String? = null,
)

/**
 * What the server reports for an added part or figure: newly created or added to the
 * quantity, and from which condition the purchase price comes, where BrickLink knows only one.
 */
data class Erfasst(val angelegt: Boolean, val nummer: String?, val priceFromState: Zustand? = null)

/** A minifigure as the add dialog collects it; see [Teilerfassung]. */
data class Figurenerfassung(
    val nummer: String,
    val blNumber: String? = null,
    val menge: Int = 1,
    val stueckpreis: Geld? = null,
    val zustand: Zustand? = null,
    val besitzer: Int? = null,
    val lagerort: String? = null,
)
