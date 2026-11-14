package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.BestandteilKopf
import ch.brickinventoryapp.vertrag.FigValuationItem
import ch.brickinventoryapp.vertrag.Minifig
import ch.brickinventoryapp.vertrag.MinifigStats
import ch.brickinventoryapp.vertrag.Part
import ch.brickinventoryapp.vertrag.PartValuationItem
import ch.brickinventoryapp.vertrag.PartsCategory
import ch.brickinventoryapp.vertrag.PartsFilterColor
import ch.brickinventoryapp.vertrag.PartsStats
import ch.brickinventoryapp.vertrag.ValuationAcquisition
import ch.brickinventoryapp.vertrag.VerwendendesSet
import ch.brickinventoryapp.model.ui.model.BestandteilKopfAnsicht
import ch.brickinventoryapp.model.ui.model.BewertungsKaufAnsicht
import ch.brickinventoryapp.model.ui.model.FigurAnsicht
import ch.brickinventoryapp.model.ui.model.FigurenKennzahlenAnsicht
import ch.brickinventoryapp.model.ui.model.FilterFarbeAnsicht
import ch.brickinventoryapp.model.ui.model.KategorieAnsicht
import ch.brickinventoryapp.model.ui.model.ManuelleFigurAnsicht
import ch.brickinventoryapp.model.ui.model.ManuellesTeilAnsicht
import ch.brickinventoryapp.model.ui.model.TeilAnsicht
import ch.brickinventoryapp.model.ui.model.TeileKennzahlenAnsicht
import ch.brickinventoryapp.model.ui.model.VerwendendesSetAnsicht

fun Part.alsAnsicht() = TeilAnsicht(
    partNumber = partNumber,
    blPartNumber = blPartNumber,
    partName = partName,
    colorId = colorId,
    blColorId = blColorId,
    colorName = colorName,
    colorHex = colorHex,
    categoryName = categoryName,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    totalQuantity = totalQuantity,
    inSets = inSets,
    isSpare = isSpare,
)

/**
 * /parts/stats zählt in total_parts nur Teile aus Sets, /stats beide zusammen;
 * ohne die Summe zeigten Sammlung und Teile-Reiter verschiedene Zahlen.
 */
fun PartsStats.alsAnsicht() = TeileKennzahlenAnsicht(
    uniqueParts = uniqueParts,
    uniqueColors = uniqueColors,
    teileGesamt = totalParts + (manualParts ?: 0),
    teileAusSets = if (manualParts != null) totalParts else null,
    teileEinzeln = manualParts,
)

fun Minifig.alsAnsicht() = FigurAnsicht(
    figNumber = figNumber,
    condition = condition,
    conditions = conditions,
    owners = owners.map { it.alsAnsicht() },
    avgPurchasePrice = avgPurchasePrice,
    figName = figName,
    quantity = quantity,
    totalQuantity = totalQuantity,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    source = source,
    setAddedAt = setAddedAt,
)

fun MinifigStats.alsAnsicht() = FigurenKennzahlenAnsicht(
    types = types,
    totalQuantity = totalQuantity,
    manual = manual,
)

fun PartsFilterColor.alsAnsicht() = FilterFarbeAnsicht(
    colorName = colorName,
    colorHex = colorHex,
    uniqueParts = uniqueParts,
    totalQuantity = totalQuantity,
)

fun PartsCategory.alsAnsicht() = KategorieAnsicht(
    categoryName = categoryName,
    label = label,
    uniqueParts = uniqueParts,
    totalQuantity = totalQuantity,
)

fun BestandteilKopf.alsAnsicht() = BestandteilKopfAnsicht(
    nummer = nummer,
    name = name,
    colorId = colorId,
    colorName = colorName,
    colorHex = colorHex,
    categoryName = categoryName,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    isSpare = isSpare,
    storage = storage,
    ownerIds = ownerIds,
    totalQuantity = totalQuantity,
)

fun VerwendendesSet.alsAnsicht() = VerwendendesSetAnsicht(
    setNumber = setNumber,
    setName = setName,
    quantity = quantity,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    ownerUserId = ownerUserId,
)

fun PartValuationItem.alsAnsicht() = ManuellesTeilAnsicht(
    id = id,
    partNumber = partNumber,
    blPartNumber = blPartNumber,
    partName = partName,
    colorId = colorId,
    colorName = colorName,
    colorHex = colorHex,
    quantity = quantity,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    unitPrice = unitPrice,
    purchasePrice = purchasePrice,
    avgPurchasePrice = avgPurchasePrice,
    qtyAvgPrice = qtyAvgPrice,
    avgPrice = avgPrice,
    pnlPct = pnlPct,
    pnlProzent = pnlProzent,
    displayValue = displayValue,
    wertGesamt = wertGesamt,
    condition = condition,
    conditions = conditions,
    userId = userId,
    owners = owners.map { it.alsAnsicht() },
    acquisitions = acquisitions.map { it.alsAnsicht() },
    storage = storage,
)

fun FigValuationItem.alsAnsicht() = ManuelleFigurAnsicht(
    id = id,
    figNumber = figNumber,
    blFigNumber = blFigNumber,
    figName = figName,
    quantity = quantity,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    unitPrice = unitPrice,
    purchasePrice = purchasePrice,
    avgPurchasePrice = avgPurchasePrice,
    qtyAvgPrice = qtyAvgPrice,
    avgPrice = avgPrice,
    pnlPct = pnlPct,
    pnlProzent = pnlProzent,
    displayValue = displayValue,
    wertGesamt = wertGesamt,
    condition = condition,
    conditions = conditions,
    userId = userId,
    owners = owners.map { it.alsAnsicht() },
    acquisitions = acquisitions.map { it.alsAnsicht() },
    storage = storage,
)

fun ValuationAcquisition.alsAnsicht() = BewertungsKaufAnsicht(
    id = id,
    condition = condition,
    quantity = quantity,
    purchasePrice = purchasePrice,
    avgPrice = avgPrice,
    totalAvg = totalAvg,
    wertGesamt = wertGesamt,
    pnlPct = pnlPct,
    pnlProzent = pnlProzent,
    createdAt = createdAt,
    ownerUserId = ownerUserId,
)
