package ch.brickinventoryapp.model.domain

/**
 * A part as the add dialog collects it. Named fields instead of nine values
 * by position: color name and color code are both `String?` and could be swapped
 * unnoticed. [NO_COLOR] means „without color“ as at the server, 0 would be black.
 */
data class PartEntry(
    val number: String,
    val colorId: Int = NO_COLOR,
    val colorName: String? = null,
    val colorHex: String? = null,
    val quantity: Int = 1,
    val unitPrice: Money? = null,
    val condition: Condition? = null,
    val owner: Int? = null,
    val storageLocation: String? = null,
)

/**
 * What the server reports for an added part or figure: newly created or added to the
 * quantity, and from which condition the purchase price comes, where BrickLink knows only one.
 */
data class Recorded(val created: Boolean, val number: String?, val priceFromState: Condition? = null)

/** A minifigure as the add dialog collects it; see [PartEntry]. */
data class FigureEntry(
    val number: String,
    val blNumber: String? = null,
    val quantity: Int = 1,
    val unitPrice: Money? = null,
    val condition: Condition? = null,
    val owner: Int? = null,
    val storageLocation: String? = null,
)
