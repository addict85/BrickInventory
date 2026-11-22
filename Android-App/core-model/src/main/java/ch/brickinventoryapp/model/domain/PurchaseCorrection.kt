package ch.brickinventoryapp.model.domain

import java.time.LocalDate

/** What is changed on a purchase; null means unchanged. [owner] moves the purchase into another account. */
data class PurchaseCorrection(
    val price: Money? = null,
    val condition: Condition? = null,
    val quantity: Int? = null,
    val datum: LocalDate? = null,
    val owner: Int? = null,
)

/**
 * What a purchase change caused: [summary] if the server sent along the new total of the
 * set and the store took it over; [parts] and [figures] moved along.
 */
data class PurchaseChange(val summary: Boolean = false, val parts: Int = 0, val figures: Int = 0)
