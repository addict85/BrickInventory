package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.AccountName
import ch.brickinventoryapp.contract.Acquisition
import ch.brickinventoryapp.contract.AcquisitionTotals
import ch.brickinventoryapp.contract.HouseholdMember
import ch.brickinventoryapp.contract.Storage
import ch.brickinventoryapp.contract.StorageEntry
import ch.brickinventoryapp.model.domain.AccountView
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.PurchaseSumsView
import ch.brickinventoryapp.model.domain.PurchaseView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.util.parseInstant

fun HouseholdMember.asView() = MemberView(
    id = id,
    username = username,
    isSelf = isSelf,
)

fun AccountName.asView() = AccountView(
    id = id,
    username = username,
)

fun Acquisition.asView() = PurchaseView(
    id = id,
    quantity = quantity,
    purchasePrice = purchasePrice.asMoney(),
    unitPrice = unitPrice.asMoney(),
    condition = condition,
    createdAt = parseInstant(createdAt),
    ownerUserId = ownerUserId,
    priceEstimated = priceEstimated,
    currency = currency,
)

fun AcquisitionTotals.asView() = PurchaseSumsView(
    quantity = quantity,
    amount = amount.asMoney(),
)

fun Storage.asView() = LocationView(
    location = location,
    sets = sets,
    parts = parts,
)

fun StorageEntry.asView() = LocationEntryView(
    id = id,
    userId = userId,
    name = name,
)
