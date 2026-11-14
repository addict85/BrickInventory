package ch.brickinventoryapp.model.fach

/**
 * Ein Set, das in die Galerie soll: was ein Erfassungsdialog einsammelt. Als
 * Datenklasse, weil die Dialoge und das ViewModel sonst sechs Werte nach ihrer
 * Stellung weiterreichen und zwei vertauschte `Int?` niemand bemerkt.
 */

data class Erfassungswunsch(
    val setNumber: String,
    val menge: Int = 1,
    val kaufpreis: Double? = null,
    /** null: Der Server nimmt die Vorgabe des Kontos. */
    val zustand: Zustand? = null,
    /** null: das eigene Konto. Ob ein anderes erlaubt ist, prüft der Server. */
    val besitzer: Int? = null,
    /** null oder leer: kein Lagerort. */
    val lagerort: String? = null,
)
