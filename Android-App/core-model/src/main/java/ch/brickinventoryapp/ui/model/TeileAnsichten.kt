package ch.brickinventoryapp.ui.model

import ch.brickinventoryapp.data.model.BestandteilKopf
import ch.brickinventoryapp.data.model.FigValuationItem
import ch.brickinventoryapp.data.model.Minifig
import ch.brickinventoryapp.data.model.MinifigStats
import ch.brickinventoryapp.data.model.Part
import ch.brickinventoryapp.data.model.PartValuationItem
import ch.brickinventoryapp.data.model.PartsCategory
import ch.brickinventoryapp.data.model.PartsFilterColor
import ch.brickinventoryapp.data.model.PartsStats
import ch.brickinventoryapp.data.model.ValuationAcquisition
import ch.brickinventoryapp.data.model.VerwendendesSet

// Teile und Minifiguren — aus Sets und manuell erfasst.

data class TeilAnsicht(
    val partNumber: String,
    val blPartNumber: String? = null,
    val partName: String? = null,
    val colorId: Int = OHNE_FARBE,
    val blColorId: Int? = null,
    val colorName: String? = null,
    val colorHex: String? = null,
    val categoryName: String? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val totalQuantity: Int = 0,
    val inSets: String? = null,
    val isSpare: Boolean = false,
)

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

data class TeileKennzahlenAnsicht(
    val uniqueParts: Int = 0,
    val uniqueColors: Int = 0,
    val totalParts: Int = 0,
)

fun PartsStats.alsAnsicht() = TeileKennzahlenAnsicht(
    uniqueParts = uniqueParts,
    uniqueColors = uniqueColors,
    totalParts = totalParts,
)

data class FigurAnsicht(
    val figNumber: String,
    val condition: String? = null,
    val conditions: List<String> = emptyList(),
    val owners: List<KontoAnsicht> = emptyList(),
    val avgPurchasePrice: Double? = null,
    val figName: String? = null,
    val quantity: Int = 1,
    val totalQuantity: Int? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val source: String = "set",
    val setAddedAt: String? = null,
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

data class FigurenKennzahlenAnsicht(
    val types: Int = 0,
    val totalQuantity: Int = 0,
    val manual: Int = 0,
)

fun MinifigStats.alsAnsicht() = FigurenKennzahlenAnsicht(
    types = types,
    totalQuantity = totalQuantity,
    manual = manual,
)

data class FilterFarbeAnsicht(
    val colorName: String? = null,
    val colorHex: String? = null,
    val uniqueParts: Int = 0,
    val totalQuantity: Int = 0,
)

fun PartsFilterColor.alsAnsicht() = FilterFarbeAnsicht(
    colorName = colorName,
    colorHex = colorHex,
    uniqueParts = uniqueParts,
    totalQuantity = totalQuantity,
)

data class KategorieAnsicht(
    val categoryName: String? = null,
    val label: String? = null,
    val uniqueParts: Int = 0,
    val totalQuantity: Int = 0,
)

fun PartsCategory.alsAnsicht() = KategorieAnsicht(
    categoryName = categoryName,
    label = label,
    uniqueParts = uniqueParts,
    totalQuantity = totalQuantity,
)

data class BestandteilKopfAnsicht(
    val nummer: String,
    val name: String? = null,
    val colorId: Int? = null,
    val colorName: String? = null,
    val colorHex: String? = null,
    val categoryName: String? = null,
    val imageLocal: String? = null,
    val imageUrl: String? = null,
    val isSpare: Boolean = false,
    val storage: String? = null,
    val ownerIds: List<Int> = emptyList(),
    val totalQuantity: Int = 0,
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

data class VerwendendesSetAnsicht(
    val setNumber: String,
    val setName: String? = null,
    val quantity: Int = 0,
    val imageLocal: String? = null,
    val imageUrl: String? = null,
    val ownerUserId: Int = 0,
)

fun VerwendendesSet.alsAnsicht() = VerwendendesSetAnsicht(
    setNumber = setNumber,
    setName = setName,
    quantity = quantity,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    ownerUserId = ownerUserId,
)

data class ManuellesTeilAnsicht(
    val id: Int? = null,
    val partNumber: String = "",
    val blPartNumber: String? = null,
    val partName: String? = null,
    val colorId: Int = OHNE_FARBE,
    val colorName: String? = null,
    val colorHex: String? = null,
    val quantity: Int = 1,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val unitPrice: Double? = null,
    val purchasePrice: Double? = null,
    val avgPurchasePrice: Double? = null,
    val qtyAvgPrice: Double? = null,
    val avgPrice: Double? = null,
    val pnlPct: String? = null,
    val pnlProzent: Double? = null,
    val displayValue: String? = null,
    val wertGesamt: Double? = null,
    val condition: String? = null,
    val conditions: List<String> = emptyList(),
    val userId: Int? = null,
    val owners: List<KontoAnsicht> = emptyList(),
    val acquisitions: List<BewertungsKaufAnsicht> = emptyList(),
    val storage: String? = null,
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

data class ManuelleFigurAnsicht(
    val id: Int? = null,
    val figNumber: String = "",
    val blFigNumber: String? = null,
    val figName: String? = null,
    val quantity: Int = 1,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val unitPrice: Double? = null,
    val purchasePrice: Double? = null,
    val avgPurchasePrice: Double? = null,
    val qtyAvgPrice: Double? = null,
    val avgPrice: Double? = null,
    val pnlPct: String? = null,
    val pnlProzent: Double? = null,
    val displayValue: String? = null,
    val wertGesamt: Double? = null,
    val condition: String? = null,
    val conditions: List<String> = emptyList(),
    val userId: Int? = null,
    val owners: List<KontoAnsicht> = emptyList(),
    val acquisitions: List<BewertungsKaufAnsicht> = emptyList(),
    val storage: String? = null,
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

data class BewertungsKaufAnsicht(
    val id: Int = 0,
    val condition: String = "N",
    val quantity: Int = 1,
    val purchasePrice: Double? = null,
    val avgPrice: Double? = null,
    val totalAvg: String? = null,
    val wertGesamt: Double? = null,
    val pnlPct: String? = null,
    val pnlProzent: Double? = null,
    val createdAt: String? = null,
    val ownerUserId: Int? = null,
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
