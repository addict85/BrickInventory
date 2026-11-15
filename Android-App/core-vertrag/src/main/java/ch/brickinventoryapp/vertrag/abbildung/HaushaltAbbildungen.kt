package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.Acquisition
import ch.brickinventoryapp.vertrag.AcquisitionTotals
import ch.brickinventoryapp.vertrag.HouseholdMember
import ch.brickinventoryapp.vertrag.KontoName
import ch.brickinventoryapp.vertrag.Lagerort
import ch.brickinventoryapp.vertrag.LagerortEintrag
import ch.brickinventoryapp.model.fach.KaufAnsicht
import ch.brickinventoryapp.model.fach.KaufSummenAnsicht
import ch.brickinventoryapp.model.fach.KontoAnsicht
import ch.brickinventoryapp.model.fach.LagerortAnsicht
import ch.brickinventoryapp.model.fach.LagerortEintragAnsicht
import ch.brickinventoryapp.model.fach.MitgliedAnsicht
import ch.brickinventoryapp.model.fach.alsGeld
import ch.brickinventoryapp.model.util.zeitpunkt

fun HouseholdMember.alsAnsicht() = MitgliedAnsicht(
    id = id,
    username = username,
    isSelf = isSelf,
)

fun KontoName.alsAnsicht() = KontoAnsicht(
    id = id,
    username = username,
)

fun Acquisition.alsAnsicht() = KaufAnsicht(
    id = id,
    quantity = quantity,
    purchasePrice = purchasePrice.alsGeld(),
    unitPrice = unitPrice.alsGeld(),
    condition = condition,
    createdAt = zeitpunkt(createdAt),
    ownerUserId = ownerUserId,
    priceEstimated = priceEstimated,
    currency = currency,
)

fun AcquisitionTotals.alsAnsicht() = KaufSummenAnsicht(
    quantity = quantity,
    amount = amount.alsGeld(),
)

fun Lagerort.alsAnsicht() = LagerortAnsicht(
    ort = ort,
    sets = sets,
    teile = teile,
)

fun LagerortEintrag.alsAnsicht() = LagerortEintragAnsicht(
    id = id,
    userId = userId,
    name = name,
)
