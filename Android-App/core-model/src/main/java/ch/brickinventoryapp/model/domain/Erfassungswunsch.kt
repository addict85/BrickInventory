package ch.brickinventoryapp.model.domain

/**
 * A set that shall go into the gallery: what an add dialog collects. As a
 * data class, because otherwise the dialogs and the ViewModel pass on six values by their
 * position and nobody notices two swapped `Int?`.
 */

data class Erfassungswunsch(
    val setNumber: String,
    val menge: Int = 1,
    val kaufpreis: Geld? = null,
    /** null: the server takes the account's default. */
    val zustand: Zustand? = null,
    /** null: the own account. Whether another one is allowed is checked by the server. */
    val besitzer: Int? = null,
    /** null or empty: no storage location. */
    val lagerort: String? = null,
)

/**
 * What the server reports for an added set. [vorhanden]: it was already in
 * view, nothing was written. [supplementPending]: name, image and prices
 * are still fetched by a job; whoever reloads the gallery earlier does not see them.
 */
data class SetRecorded(
    val nummer: String?,
    val name: String? = null,
    val angelegt: Boolean = false,
    val vorhanden: Boolean = false,
    val katalogOffen: Boolean = false,
    val supplementPending: Boolean = false,
)
