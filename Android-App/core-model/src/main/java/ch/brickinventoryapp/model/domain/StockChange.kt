package ch.brickinventoryapp.model.domain

// What an edit of the stock carries when it waits in the outbox or the store catches up.

/** A wishlist item that shall be created; [owner] null means the own account. */
data class WantedRequest(val setNumber: String, val condition: Condition = Condition.NEW, val owner: Int? = null)

/**
 * What is changed on a manual part or a figure. With [step] two devices add
 * up (quantity_delta); a server without it takes [quantity], then the last one wins.
 */
data class QuantityChange(
    val quantity: Int,
    val step: Int? = null,
    val unitPrice: Money? = null,
    val condition: Condition? = null,
    val blNumber: String? = null,
)

/**
 * The purchase total of a set after a purchase change, complete: a price null means
 * „none recorded“, not „unknown“.
 */
data class SetTotals(
    val setNumber: String,
    val condition: Condition,
    val states: List<Condition>,
    val used: Int,
    val highestPurchasePrice: Money?,
    val purchasePriceCut: Money?,
)
