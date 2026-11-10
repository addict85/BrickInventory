package ch.brickinventoryapp.model.fach

import kotlinx.serialization.Serializable

/**
 * Welche Art Posten gemeint ist: ein Set, ein Teil oder eine Figur. Als Typ von der
 * Route bis ins ViewModel, damit kein Bildschirm „fig“ falsch schreibt; [kennung] ist
 * der Text des Servers und geht nur in der Api-Schicht über die Leitung.
 */
@Serializable
enum class Postenart(val kennung: String) {
    SET("set"), PART("part"), FIG("fig");

    companion object {
        /** Wirft bei einem unbekannten Text: Die Kennungen stammen aus dem eigenen Code. */
        fun aus(kennung: String): Postenart = entries.first { it.kennung == kennung }
    }
}
