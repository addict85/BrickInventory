package ch.brickinventoryapp.data.local

import ch.brickinventoryapp.contract.AddMinifigRequest
import ch.brickinventoryapp.contract.AddPartRequest
import ch.brickinventoryapp.contract.AddSetRequest
import ch.brickinventoryapp.contract.SetAggregate
import ch.brickinventoryapp.contract.UpdateManualItemRequest
import ch.brickinventoryapp.contract.WantedItemRequest
import ch.brickinventoryapp.model.domain.EntryRequest
import ch.brickinventoryapp.model.domain.FigureEntry
import ch.brickinventoryapp.model.domain.PartEntry
import ch.brickinventoryapp.model.domain.QuantityChange
import ch.brickinventoryapp.model.domain.SetTotals
import ch.brickinventoryapp.model.domain.WantedRequest
import ch.brickinventoryapp.model.domain.asMoney

/*
 * The requests for the store's edits: the store holds domain values, only here does
 * the wire format arise from them, for the direct attempt as for sending from the outbox.
 */

internal fun EntryRequest.asRequest() = AddSetRequest(setNumber = setNumber, quantity = quantity,
    purchasePrice = purchasePrice?.asDouble(), condition = condition, ownerUserId = owner, storage = storageLocation)

internal fun WantedRequest.asRequest() = WantedItemRequest(setNumber = setNumber, condition = condition, ownerUserId = owner)

internal fun PartEntry.asRequest() = AddPartRequest(partNumber = number, colorId = colorId, colorName = colorName,
    colorHex = colorHex, quantity = quantity, unitPrice = unitPrice?.asDouble(), condition = condition, ownerUserId = owner,
    storage = storageLocation)

internal fun FigureEntry.asRequest() = AddMinifigRequest(figNumber = number, blFigNumber = blNumber, quantity = quantity,
    unitPrice = unitPrice?.asDouble(), condition = condition, ownerUserId = owner, storage = storageLocation)

internal fun QuantityChange.asRequest() = UpdateManualItemRequest(quantity = quantity, quantityDelta = step,
    unitPrice = unitPrice?.asDouble(), condition = condition, blFigNumber = blNumber)

internal fun SetAggregate.asSummary() = SetTotals(setNumber = setNumber, condition = condition,
    states = conditions, used = usedCount, highestPurchasePrice = maxPurchasePrice.asMoney(),
    purchasePriceCut = avgPurchasePrice.asMoney())
