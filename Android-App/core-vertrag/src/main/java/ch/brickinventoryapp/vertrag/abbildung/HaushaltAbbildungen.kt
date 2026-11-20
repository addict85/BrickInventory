package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.Acquisition
import ch.brickinventoryapp.vertrag.AcquisitionTotals
import ch.brickinventoryapp.vertrag.HouseholdMember
import ch.brickinventoryapp.vertrag.KontoName
import ch.brickinventoryapp.vertrag.Lagerort
import ch.brickinventoryapp.vertrag.LagerortEintrag
import ch.brickinventoryapp.model.fach.KaufAnsicht
import ch.brickinventoryapp.model.fach.PurchaseSumsView
import ch.brickinventoryapp.model.fach.AccountView
import ch.brickinventoryapp.model.fach.LocationView
import ch.brickinventoryapp.model.fach.LocationEntryView
import ch.brickinventoryapp.model.fach.MemberView
import ch.brickinventoryapp.model.fach.asMoney
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
