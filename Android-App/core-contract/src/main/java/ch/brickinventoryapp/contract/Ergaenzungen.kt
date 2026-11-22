package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.Zustand

// Identifiers and derived values for the generated types (Vertrag.kt): the generator
// only writes fields; what the app reads from them stands once here instead of per caller.

/** Only the conditions for which the server delivered a row. */
fun PriceByCondition.present(): List<Pair<Zustand, ConditionValuation>> = buildList {
    new?.let { add(Zustand.NEU to it) }
    used?.let { add(Zustand.GEBRAUCHT to it) }
}

/** All parent accounts; an older server sends only `linked_to`. */
val HouseholdStatusResponse.elternkonten: List<KontoName>
    get() = parents.ifEmpty { listOfNotNull(linkedTo) }

/** Sets carry the price as `purchase_price`, parts and figures as `unit_price`. */
val Acquisition.effectivePrice: Double? get() = purchasePrice ?: unitPrice

/** Quantity-weighted by the server so that tile and detail show the same number. */
val SetItem.displayPurchasePrice: Double? get() = avgPurchasePrice

/** Neu angelegte Zeilen eines CSV-Imports. */
val CsvImportErgebnis.newCreated: Int get() = added

/**
 * The server reads the price under the name of its column: `purchase_price` for sets,
 * `unit_price` for parts and figures; under the wrong name it would silently stay the same.
 */
fun changeForSet(
    preis: Double? = null,
    condition: Zustand? = null,
    quantity: Int? = null,
    date: String? = null,
    ownerUserId: Int? = null,
) = UpdateAcquisitionRequest(
    purchasePrice = preis, condition = condition, quantity = quantity, date = date, ownerUserId = ownerUserId,
)

/** For parts and minifigures: the price goes as `unit_price`. See [changeForSet]. */
fun changeForPiece(
    preis: Double? = null,
    condition: Zustand? = null,
    quantity: Int? = null,
    date: String? = null,
    ownerUserId: Int? = null,
) = UpdateAcquisitionRequest(
    unitPrice = preis, condition = condition, quantity = quantity, date = date, ownerUserId = ownerUserId,
)

/** A location in the supply as the store keeps it: [vorgabe] is the star the server sends next to the list. */
data class StockLocation(val ort: LagerortEintrag, val vorgabe: Boolean)
