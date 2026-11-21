package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.Acquisition
import ch.brickinventoryapp.contract.AcquisitionTotals
import ch.brickinventoryapp.contract.HouseholdMember
import ch.brickinventoryapp.contract.KontoName
import ch.brickinventoryapp.contract.Lagerort
import ch.brickinventoryapp.contract.LagerortEintrag
import ch.brickinventoryapp.model.domain.KaufAnsicht
import ch.brickinventoryapp.model.domain.PurchaseSumsView
import ch.brickinventoryapp.model.domain.AccountView
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.LocationEntryView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.util.zeitpunkt

fun HouseholdMember.alsAnsicht() = MemberView(
    id = id,
    username = username,
    isSelf = isSelf,
)

fun KontoName.alsAnsicht() = AccountView(
    id = id,
    username = username,
)

fun Acquisition.alsAnsicht() = KaufAnsicht(
    id = id,
    quantity = quantity,
    purchasePrice = purchasePrice.asMoney(),
    unitPrice = unitPrice.asMoney(),
    condition = condition,
    createdAt = zeitpunkt(createdAt),
    ownerUserId = ownerUserId,
    priceEstimated = priceEstimated,
    currency = currency,
)

fun AcquisitionTotals.alsAnsicht() = PurchaseSumsView(
    quantity = quantity,
    amount = amount.asMoney(),
)

fun Lagerort.alsAnsicht() = LocationView(
    ort = ort,
    sets = sets,
    teile = teile,
)

fun LagerortEintrag.alsAnsicht() = LocationEntryView(
    id = id,
    userId = userId,
    name = name,
)
