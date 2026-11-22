package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.Condition

// Identifiers and derived values for the generated types (Contract.kt): the generator
// only writes fields; what the app reads from them stands once here instead of per caller.

/** Only the conditions for which the server delivered a row. */
fun PriceByCondition.present(): List<Pair<Condition, ConditionValuation>> = buildList {
    new?.let { add(Condition.NEW to it) }
    used?.let { add(Condition.USED to it) }
}

/** All parent accounts; an older server sends only `linked_to`. */
val HouseholdStatusResponse.parentAccounts: List<AccountName>
    get() = parents.ifEmpty { listOfNotNull(linkedTo) }

/** Sets carry the price as `purchase_price`, parts and figures as `unit_price`. */
val Acquisition.effectivePrice: Double? get() = purchasePrice ?: unitPrice

/** Quantity-weighted by the server so that tile and detail show the same number. */
val SetItem.displayPurchasePrice: Double? get() = avgPurchasePrice

/** Neu angelegte Zeilen eines CSV-Imports. */
val CsvImportResult.newCreated: Int get() = added

/**
 * The server reads the price under the name of its column: `purchase_price` for sets,
 * `unit_price` for parts and figures; under the wrong name it would silently stay the same.
 */
fun changeForSet(
    price: Double? = null,
    condition: Condition? = null,
    quantity: Int? = null,
    date: String? = null,
    ownerUserId: Int? = null,
) = UpdateAcquisitionRequest(
    purchasePrice = price, condition = condition, quantity = quantity, date = date, ownerUserId = ownerUserId,
)

/** For parts and minifigures: the price goes as `unit_price`. See [changeForSet]. */
fun changeForPiece(
    price: Double? = null,
    condition: Condition? = null,
    quantity: Int? = null,
    date: String? = null,
    ownerUserId: Int? = null,
) = UpdateAcquisitionRequest(
    unitPrice = price, condition = condition, quantity = quantity, date = date, ownerUserId = ownerUserId,
)

/** A location in the supply as the store keeps it: [default] is the star the server sends next to the list. */
data class StockLocation(val location: StorageEntry, val default: Boolean)
