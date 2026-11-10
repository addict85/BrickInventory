package ch.brickinventoryapp.model.fach

import kotlinx.serialization.Serializable

/**
 * Eine Währung als ISO-Code. Auf der Leitung ein blosser Text (value class), damit
 * sich am Vertrag nichts ändert; im Code ein eigener Typ, damit kein Setname oder
 * Betrag versehentlich als Währung durchgeht. Den Code prüft erst die Anzeige: Einen
 * unbekannten zeigt sie als Text vor dem Betrag, statt die Antwort zu verwerfen.
 */
@Serializable
@JvmInline
value class Waehrung(val code: String) {
    /** Leer heisst: Der Server hat keine genannt. */
    val bekannt: Boolean get() = code.isNotBlank()

    override fun toString(): String = code

    companion object {
        val EUR = Waehrung("EUR")
        val CHF = Waehrung("CHF")
        val KEINE = Waehrung("")

        /** Die Wahl in den Einstellungen; dieselben wie in der Webapp. */
        val WAEHLBAR = listOf(CHF, EUR, Waehrung("USD"), Waehrung("GBP"))
    }
}
