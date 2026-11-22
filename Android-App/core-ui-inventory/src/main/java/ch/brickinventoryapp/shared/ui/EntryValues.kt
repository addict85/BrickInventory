package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.ui.util.NumericInput

/**
 * The four inputs, as the server needs them — one conversion for both
 * dialogs: an empty quantity means one, the price is read like in the web app
 * (NumericInput.readAmount), and without a household no owner goes along, so the
 * server stays with its own account. An unreadable input isn't silently turned into
 * one or „no price" here: whoever saves asks [entryInvalid] first.
 */
data class EntryValues(
    val count: Int,
    val price: Money?,
    val condition: Condition,
    val owner: Int?,
)

/**
 * @param haushalt The household's accounts — with at most one, NO
 *                 owner goes along.
 */
fun entryValues(
    count: String,
    price: String,
    condition: Condition,
    owner: Int?,
    household: List<MemberView>,
): EntryValues = EntryValues(
    count = count.toIntOrNull() ?: 1,
    price = NumericInput.readMoney(price),
    condition = condition,
    owner = if (household.size > 1) owner else null,
)

/** Whether quantity or price carry something unreadable; if so the dialog doesn't save, and the field says why. */
fun entryInvalid(count: String, price: String): Boolean =
    NumericInput.quantityInvalid(count) || NumericInput.priceInvalid(price)
