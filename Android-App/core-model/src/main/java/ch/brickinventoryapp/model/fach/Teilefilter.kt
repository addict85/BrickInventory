package ch.brickinventoryapp.model.fach

import java.io.Serializable

/**
 * Die Farbwahl des Teilefilters. Der Server filtert nach dem Farbnamen (`color=`), deshalb
 * trägt die Wahl den Namen; „alle“ ist eine eigene Wahl statt eines leeren Textes. Serializable,
 * weil der Teilefilter im SavedStateHandle liegt.
 */
sealed interface Farbwahl : Serializable {
    data object Alle : Farbwahl

    data class Farbe(val name: String) : Farbwahl

    /** Der Wert für Abfrage und Ablage; null heisst alle. */
    val wert: String? get() = (this as? Farbe)?.name

    companion object {
        fun aus(text: String?): Farbwahl = text?.takeIf { it.isNotBlank() }?.let(::Farbe) ?: Alle
    }
}

/** Die Kategoriewahl; gewählt wird der Wert des Servers (`category_name`), nicht die Beschriftung. */
sealed interface Kategoriewahl : Serializable {
    data object Alle : Kategoriewahl

    data class Kategorie(val name: String) : Kategoriewahl

    val wert: String? get() = (this as? Kategorie)?.name

    companion object {
        fun aus(text: String?): Kategoriewahl = text?.takeIf { it.isNotBlank() }?.let(::Kategorie) ?: Alle
    }
}
