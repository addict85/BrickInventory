package ch.brickinventoryapp.model.domain

import java.io.Serializable

/**
 * The color choice of the parts filter. The server filters by the color name (`color=`), therefore
 * the choice carries the name; „all“ is a choice of its own instead of an empty text. Serializable,
 * because the parts filter lies in the SavedStateHandle.
 */
sealed interface ColorPicker : Serializable {
    data object Alle : ColorPicker

    data class Farbe(val name: String) : ColorPicker

    /** The value for query and store; null means all. */
    val wert: String? get() = (this as? Farbe)?.name

    companion object {
        fun aus(text: String?): ColorPicker = text?.takeIf { it.isNotBlank() }?.let(::Farbe) ?: Alle
    }
}

/** The category choice; chosen is the server's value (`category_name`), not the label. */
sealed interface Kategoriewahl : Serializable {
    data object Alle : Kategoriewahl

    data class Kategorie(val name: String) : Kategoriewahl

    val wert: String? get() = (this as? Kategorie)?.name

    companion object {
        fun aus(text: String?): Kategoriewahl = text?.takeIf { it.isNotBlank() }?.let(::Kategorie) ?: Alle
    }
}
