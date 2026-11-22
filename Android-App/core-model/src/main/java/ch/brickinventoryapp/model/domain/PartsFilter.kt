package ch.brickinventoryapp.model.domain

import java.io.Serializable

/**
 * The color choice of the parts filter. The server filters by the color name (`color=`), therefore
 * the choice carries the name; „all“ is a choice of its own instead of an empty text. Serializable,
 * because the parts filter lies in the SavedStateHandle.
 */
sealed interface ColorPicker : Serializable {
    data object All : ColorPicker

    data class Color(val name: String) : ColorPicker

    /** The value for query and store; null means all. */
    val value: String? get() = (this as? Color)?.name

    companion object {
        fun from(text: String?): ColorPicker = text?.takeIf { it.isNotBlank() }?.let(::Color) ?: All
    }
}

/** The category choice; chosen is the server's value (`category_name`), not the label. */
sealed interface CategoryChoice : Serializable {
    data object All : CategoryChoice

    data class Category(val name: String) : CategoryChoice

    val value: String? get() = (this as? Category)?.name

    companion object {
        fun from(text: String?): CategoryChoice = text?.takeIf { it.isNotBlank() }?.let(::Category) ?: All
    }
}
