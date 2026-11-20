package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.BestandteilKopf
import ch.brickinventoryapp.contract.FigValuationItem
import ch.brickinventoryapp.contract.Minifig
import ch.brickinventoryapp.contract.MinifigStats
import ch.brickinventoryapp.contract.Part
import ch.brickinventoryapp.contract.PartValuationItem
import ch.brickinventoryapp.contract.PartsCategory
import ch.brickinventoryapp.contract.PartsFilterColor
import ch.brickinventoryapp.contract.PartsStats
import ch.brickinventoryapp.contract.ValuationAcquisition
import ch.brickinventoryapp.contract.VerwendendesSet
import ch.brickinventoryapp.contract.VerwendendeSetsResponse
import ch.brickinventoryapp.contract.StockLocation
import ch.brickinventoryapp.model.domain.UsageView
import ch.brickinventoryapp.model.domain.StockLocationView
import ch.brickinventoryapp.model.domain.ComponentHeaderView
import ch.brickinventoryapp.model.domain.ValuationPurchaseView
import ch.brickinventoryapp.model.domain.FigurAnsicht
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import ch.brickinventoryapp.model.domain.FilterColorView
import ch.brickinventoryapp.model.domain.CategoryView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.TeilAnsicht
import ch.brickinventoryapp.model.domain.PartsMetricsView
import ch.brickinventoryapp.model.domain.UsingSetView
import ch.brickinventoryapp.model.domain.Herkunft
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.util.zeitpunkt

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
fun PartsStats.alsAnsicht() = PartsMetricsView(
    uniqueParts = uniqueParts,
    uniqueColors = uniqueColors,
    teileGesamt = totalParts + (manualParts ?: 0),
    partsFromSets = if (manualParts != null) totalParts else null,
    partsSingle = manualParts,
)

fun Minifig.alsAnsicht() = FigurAnsicht(
    figNumber = figNumber,
    condition = condition,
    conditions = conditions,
    owners = owners.map { it.alsAnsicht() },
    avgPurchasePrice = avgPurchasePrice.asMoney(),
    figName = figName,
    quantity = quantity,
    totalQuantity = totalQuantity,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    source = Herkunft.aus(source),
    setAddedAt = zeitpunkt(setAddedAt),
)

fun MinifigStats.alsAnsicht() = MinifigsMetricsView(
    types = types,
    totalQuantity = totalQuantity,
    manual = manual,
)

fun PartsFilterColor.alsAnsicht() = FilterColorView(
    colorName = colorName,
    colorHex = colorHex,
    uniqueParts = uniqueParts,
    totalQuantity = totalQuantity,
)

fun PartsCategory.alsAnsicht() = CategoryView(
    categoryName = categoryName,
    label = label,
    uniqueParts = uniqueParts,
    totalQuantity = totalQuantity,
)

fun BestandteilKopf.alsAnsicht() = ComponentHeaderView(
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

fun VerwendendesSet.alsAnsicht() = UsingSetView(
    setNumber = setNumber,
    setName = setName,
    quantity = quantity,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    ownerUserId = ownerUserId,
)

fun PartValuationItem.alsAnsicht() = ManualPartView(
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
    unitPrice = unitPrice.asMoney(),
    purchasePrice = purchasePrice.asMoney(),
    avgPurchasePrice = avgPurchasePrice.asMoney(),
    qtyAvgPrice = qtyAvgPrice.asMoney(),
    avgPrice = avgPrice.asMoney(),
    pnlPct = pnlPct,
    pnlProzent = pnlProzent,
    displayValue = displayValue,
    wertGesamt = wertGesamt.asMoney(),
    condition = condition,
    conditions = conditions,
    userId = userId,
    owners = owners.map { it.alsAnsicht() },
    acquisitions = acquisitions.map { it.alsAnsicht() },
    storage = storage,
)

fun FigValuationItem.alsAnsicht() = ManualMinifigView(
    id = id,
    figNumber = figNumber,
    blFigNumber = blFigNumber,
    figName = figName,
    quantity = quantity,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    unitPrice = unitPrice.asMoney(),
    purchasePrice = purchasePrice.asMoney(),
    avgPurchasePrice = avgPurchasePrice.asMoney(),
    qtyAvgPrice = qtyAvgPrice.asMoney(),
    avgPrice = avgPrice.asMoney(),
    pnlPct = pnlPct,
    pnlProzent = pnlProzent,
    displayValue = displayValue,
    wertGesamt = wertGesamt.asMoney(),
    condition = condition,
    conditions = conditions,
    userId = userId,
    owners = owners.map { it.alsAnsicht() },
    acquisitions = acquisitions.map { it.alsAnsicht() },
    storage = storage,
)

fun ValuationAcquisition.alsAnsicht() = ValuationPurchaseView(
    id = id,
    condition = condition,
    quantity = quantity,
    purchasePrice = purchasePrice.asMoney(),
    avgPrice = avgPrice.asMoney(),
    totalAvg = totalAvg,
    wertGesamt = wertGesamt.asMoney(),
    pnlPct = pnlPct,
    pnlProzent = pnlProzent,
    createdAt = zeitpunkt(createdAt),
)

fun VerwendendeSetsResponse.alsAnsicht() = UsageView(kopf = item?.alsAnsicht(), sets = sets.map { it.alsAnsicht() })

fun StockLocation.alsAnsicht() = StockLocationView(ort = ort.alsAnsicht(), vorgabe = vorgabe)
