package ch.brickinventoryapp.parts.ui

import ch.brickinventoryapp.model.domain.OHNE_FARBE

// The rows of the temporary parts list. A file of its own without Compose, so that
// resolving a set (ui/Teileliste.kt) can be checked without a UI.

/** "10294" means "10294-1" — as everywhere a set number is typed. */
internal fun normalized(nr: String): String = if (nr.contains("-")) nr.trim() else "${nr.trim()}-1"

data class PlSet(val setNumber: String, val name: String = "")

data class PlPart(
    val partNumber: String,
    val blPartNumber: String? = null,
    val partName: String,
    val colorName: String,
    val colorHex: String?,
    val colorId: Int = OHNE_FARBE,
    val blColorId: Int? = null,
    val quantity: Int,
    val imageUrl: String?,
    val imageLocal: String? = null,
    val isFig: Boolean = false,
    /**
     * How many of these are in one's own stock — `null` as long as it has not
     * been queried.
     * `null` and `0` differ: not queried versus queried and none present.
     */
    val vorhanden: Int? = null,
)
