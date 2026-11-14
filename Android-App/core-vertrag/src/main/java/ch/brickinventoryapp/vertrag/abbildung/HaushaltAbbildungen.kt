package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.Acquisition
import ch.brickinventoryapp.vertrag.AcquisitionTotals
import ch.brickinventoryapp.vertrag.HouseholdMember
import ch.brickinventoryapp.vertrag.KontoName
import ch.brickinventoryapp.vertrag.Lagerort
import ch.brickinventoryapp.vertrag.LagerortEintrag
import ch.brickinventoryapp.model.ui.model.KaufAnsicht
import ch.brickinventoryapp.model.ui.model.KaufSummenAnsicht
import ch.brickinventoryapp.model.ui.model.KontoAnsicht
import ch.brickinventoryapp.model.ui.model.LagerortAnsicht
import ch.brickinventoryapp.model.ui.model.LagerortEintragAnsicht
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht

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
    purchasePrice = purchasePrice,
    unitPrice = unitPrice,
    condition = condition,
    createdAt = createdAt,
    ownerUserId = ownerUserId,
    priceEstimated = priceEstimated,
    currency = currency,
)

fun AcquisitionTotals.alsAnsicht() = KaufSummenAnsicht(
    quantity = quantity,
    amount = amount,
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
