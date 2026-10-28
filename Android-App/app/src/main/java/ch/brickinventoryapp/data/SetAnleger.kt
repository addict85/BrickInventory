package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.model.AddSetResponse
import kotlinx.coroutines.flow.Flow

/**
 * Ein Set anlegen und dabei die Schritte des Servers mitbekommen. Im Gerät
 * über den Ereignisstrom ([SetAnlegenSseClient]); die Schnittstelle lässt die
 * Erfassung ohne Netz und Einstellungen prüfen.
 */
interface SetAnleger {
    fun anlegen(
        setNumber: String, quantity: Int, purchasePrice: Double?,
        condition: String?, ownerUserId: Int?, storage: String? = null,
    ): Flow<SetAnlegenSchritt>
}

/** Was der Server beim Anlegen meldet; der letzte Schritt ist Fertig oder Fehler. */
sealed class SetAnlegenSchritt {
    data class Stammdaten(val name: String?) : SetAnlegenSchritt()
    object Bild : SetAnlegenSchritt()
    object FastFertig : SetAnlegenSchritt()
    data class Fertig(val ergebnis: AddSetResponse) : SetAnlegenSchritt()
    /** Leere Meldung: Die Verbindung brach ab — ein Netzfehler, kein Satz des Servers. */
    data class Fehler(val meldung: String) : SetAnlegenSchritt()
}
