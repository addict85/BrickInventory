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
import ch.brickinventoryapp.vertrag.VerwendendeSetsResponse
import ch.brickinventoryapp.vertrag.StockLocation
import ch.brickinventoryapp.model.fach.UsageView
import ch.brickinventoryapp.model.fach.StockLocationView
import ch.brickinventoryapp.model.fach.ComponentHeaderView
import ch.brickinventoryapp.model.fach.ValuationPurchaseView
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.MinifigsMetricsView
import ch.brickinventoryapp.model.fach.FilterColorView
import ch.brickinventoryapp.model.fach.CategoryView
import ch.brickinventoryapp.model.fach.ManualMinifigView
import ch.brickinventoryapp.model.fach.ManualPartView
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.PartsMetricsView
import ch.brickinventoryapp.model.fach.UsingSetView
import ch.brickinventoryapp.model.fach.Herkunft
import ch.brickinventoryapp.model.fach.asMoney
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
