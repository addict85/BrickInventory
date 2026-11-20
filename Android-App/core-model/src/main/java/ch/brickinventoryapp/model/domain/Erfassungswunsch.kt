package ch.brickinventoryapp.model.domain

/**
 * Ein Set, das in die Galerie soll: was ein Erfassungsdialog einsammelt. Als
 * Datenklasse, weil die Dialoge und das ViewModel sonst sechs Werte nach ihrer
 * Stellung weiterreichen und zwei vertauschte `Int?` niemand bemerkt.
 */

data class Erfassungswunsch(
    val setNumber: String,
    val menge: Int = 1,
    val kaufpreis: Geld? = null,
    /** null: Der Server nimmt die Vorgabe des Kontos. */
    val zustand: Zustand? = null,
    /** null: das eigene Konto. Ob ein anderes erlaubt ist, prüft der Server. */
    val besitzer: Int? = null,
    /** null oder leer: kein Lagerort. */
    val lagerort: String? = null,
)

/**
 * Was der Server zu einem erfassten Set meldet. [vorhanden]: Es stand schon im
 * Blickfeld, geschrieben wurde nichts. [supplementPending]: Name, Bild und Preise
 * holt ein Auftrag erst noch; wer die Galerie früher nachlädt, sieht sie nicht.
 */
data class SetRecorded(
    val nummer: String?,
    val name: String? = null,
    val angelegt: Boolean = false,
    val vorhanden: Boolean = false,
    val katalogOffen: Boolean = false,
    val supplementPending: Boolean = false,
)
