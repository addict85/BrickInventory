package ch.brickinventoryapp.model.domain

/**
 * A set that shall go into the gallery: what an add dialog collects. As a
 * data class, because otherwise the dialogs and the ViewModel pass on six values by their
 * position and nobody notices two swapped `Int?`.
 */

data class EntryRequest(
    val setNumber: String,
    val quantity: Int = 1,
    val purchasePrice: Money? = null,
    /** null: the server takes the account's default. */
    val condition: Condition? = null,
    /** null: the own account. Whether another one is allowed is checked by the server. */
    val owner: Int? = null,
    /** null or empty: no storage location. */
    val storageLocation: String? = null,
)

/**
 * What the server reports for an added set. [present]: it was already in
 * view, nothing was written. [supplementPending]: name, image and prices
 * are still fetched by a job; whoever reloads the gallery earlier does not see them.
 */
data class SetRecorded(
    val number: String?,
    val name: String? = null,
    val created: Boolean = false,
    val present: Boolean = false,
    val catalogOpen: Boolean = false,
    val supplementPending: Boolean = false,
)
