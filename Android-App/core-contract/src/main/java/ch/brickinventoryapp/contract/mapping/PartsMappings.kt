package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.ComponentHeader
import ch.brickinventoryapp.contract.FigValuationItem
import ch.brickinventoryapp.contract.Minifig
import ch.brickinventoryapp.contract.MinifigStats
import ch.brickinventoryapp.contract.Part
import ch.brickinventoryapp.contract.PartValuationItem
import ch.brickinventoryapp.contract.PartsCategory
import ch.brickinventoryapp.contract.PartsFilterColor
import ch.brickinventoryapp.contract.PartsStats
import ch.brickinventoryapp.contract.StockLocation
import ch.brickinventoryapp.contract.UsingSet
import ch.brickinventoryapp.contract.UsingSetsResponse
import ch.brickinventoryapp.contract.ValuationAcquisition
import ch.brickinventoryapp.model.domain.CategoryView
import ch.brickinventoryapp.model.domain.ComponentHeaderView
import ch.brickinventoryapp.model.domain.FigureView
import ch.brickinventoryapp.model.domain.FilterColorView
import ch.brickinventoryapp.model.domain.ManualMinifigView
import ch.brickinventoryapp.model.domain.ManualPartView
import ch.brickinventoryapp.model.domain.MinifigsMetricsView
import ch.brickinventoryapp.model.domain.Origin
import ch.brickinventoryapp.model.domain.PartView
import ch.brickinventoryapp.model.domain.PartsMetricsView
import ch.brickinventoryapp.model.domain.StockLocationView
import ch.brickinventoryapp.model.domain.UsageView
import ch.brickinventoryapp.model.domain.UsingSetView
import ch.brickinventoryapp.model.domain.ValuationPurchaseView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.util.parseInstant

fun Part.asView() = PartView(
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
 * /parts/stats counts in total_parts only parts from sets, /stats both together;
 * without the sum collection and parts tab would show different numbers.
 */
fun PartsStats.asView() = PartsMetricsView(
    uniqueParts = uniqueParts,
    uniqueColors = uniqueColors,
    partsTotal = totalParts + (manualParts ?: 0),
    partsFromSets = if (manualParts != null) totalParts else null,
    partsSingle = manualParts,
)

fun Minifig.asView() = FigureView(
    figNumber = figNumber,
    condition = condition,
    conditions = conditions,
    owners = owners.map { it.asView() },
    avgPurchasePrice = avgPurchasePrice.asMoney(),
    figName = figName,
    quantity = quantity,
    totalQuantity = totalQuantity,
    imageUrl = imageUrl,
    imageLocal = imageLocal,
    source = Origin.from(source),
    setAddedAt = parseInstant(setAddedAt),
)

fun MinifigStats.asView() = MinifigsMetricsView(
    types = types,
    totalQuantity = totalQuantity,
    manual = manual,
)

fun PartsFilterColor.asView() = FilterColorView(
    colorName = colorName,
    colorHex = colorHex,
    uniqueParts = uniqueParts,
    totalQuantity = totalQuantity,
)

fun PartsCategory.asView() = CategoryView(
    categoryName = categoryName,
    label = label,
    uniqueParts = uniqueParts,
    totalQuantity = totalQuantity,
)

fun ComponentHeader.asView() = ComponentHeaderView(
    number = number,
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

fun UsingSet.asView() = UsingSetView(
    setNumber = setNumber,
    setName = setName,
    quantity = quantity,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    ownerUserId = ownerUserId,
)

fun PartValuationItem.asView() = ManualPartView(
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
    pnlPercent = pnlPercent,
    displayValue = displayValue,
    valueTotal = valueTotal.asMoney(),
    condition = condition,
    conditions = conditions,
    userId = userId,
    owners = owners.map { it.asView() },
    acquisitions = acquisitions.map { it.asView() },
    storage = storage,
)

fun FigValuationItem.asView() = ManualMinifigView(
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
    pnlPercent = pnlPercent,
    displayValue = displayValue,
    valueTotal = valueTotal.asMoney(),
    condition = condition,
    conditions = conditions,
    userId = userId,
    owners = owners.map { it.asView() },
    acquisitions = acquisitions.map { it.asView() },
    storage = storage,
)

fun ValuationAcquisition.asView() = ValuationPurchaseView(
    id = id,
    condition = condition,
    quantity = quantity,
    purchasePrice = purchasePrice.asMoney(),
    avgPrice = avgPrice.asMoney(),
    totalAvg = totalAvg,
    valueTotal = valueTotal.asMoney(),
    pnlPct = pnlPct,
    pnlPercent = pnlPercent,
    createdAt = parseInstant(createdAt),
)

fun UsingSetsResponse.asView() = UsageView(header = item?.asView(), sets = sets.map { it.asView() })

fun StockLocation.asView() = StockLocationView(location = location.asView(), default = default)
