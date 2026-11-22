package ch.brickinventoryapp.model.domain

import java.time.Instant

// Parts and minifigures — from sets and entered manually.

data class PartView(
    val partNumber: String,
    val blPartNumber: String? = null,
    val partName: String? = null,
    val colorId: Int = WITHOUT_COLOR,
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

/** [partsTotal] is the total as in the collection: from sets and entered individually together. */
data class PartsMetricsView(
    val uniqueParts: Int = 0,
    val uniqueColors: Int = 0,
    val partsTotal: Int = 0,
    val partsFromSets: Int? = null,
    val partsSingle: Int? = null,
)

data class FigureView(
    val figNumber: String,
    val condition: Condition? = null,
    val conditions: List<Condition> = emptyList(),
    val owners: List<AccountView> = emptyList(),
    val avgPurchasePrice: Money? = null,
    val figName: String? = null,
    val quantity: Int = 1,
    val totalQuantity: Int? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val source: Origin = Origin.SET,
    val setAddedAt: Instant? = null,
)

data class MinifigsMetricsView(
    val types: Int = 0,
    val totalQuantity: Int = 0,
    val manual: Int = 0,
)

data class FilterColorView(
    val colorName: String? = null,
    val colorHex: String? = null,
    val uniqueParts: Int = 0,
    val totalQuantity: Int = 0,
)

data class CategoryView(
    val categoryName: String? = null,
    val label: String? = null,
    val uniqueParts: Int = 0,
    val totalQuantity: Int = 0,
)

data class ComponentHeaderView(
    val number: String,
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

data class UsingSetView(
    val setNumber: String,
    val setName: String? = null,
    val quantity: Int = 0,
    val imageLocal: String? = null,
    val imageUrl: String? = null,
    val ownerUserId: Int = 0,
)

data class ManualPartView(
    val id: Int? = null,
    val partNumber: String = "",
    val blPartNumber: String? = null,
    val partName: String? = null,
    val colorId: Int = WITHOUT_COLOR,
    val colorName: String? = null,
    val colorHex: String? = null,
    val quantity: Int = 1,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val unitPrice: Money? = null,
    val purchasePrice: Money? = null,
    val avgPurchasePrice: Money? = null,
    val qtyAvgPrice: Money? = null,
    val avgPrice: Money? = null,
    val pnlPct: String? = null,
    val pnlPercent: Double? = null,
    val displayValue: String? = null,
    val valueTotal: Money? = null,
    val condition: Condition? = null,
    val conditions: List<Condition> = emptyList(),
    val userId: Int? = null,
    val owners: List<AccountView> = emptyList(),
    val acquisitions: List<ValuationPurchaseView> = emptyList(),
    val storage: String? = null,
)

data class ManualMinifigView(
    val id: Int? = null,
    val figNumber: String = "",
    val blFigNumber: String? = null,
    val figName: String? = null,
    val quantity: Int = 1,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val unitPrice: Money? = null,
    val purchasePrice: Money? = null,
    val avgPurchasePrice: Money? = null,
    val qtyAvgPrice: Money? = null,
    val avgPrice: Money? = null,
    val pnlPct: String? = null,
    val pnlPercent: Double? = null,
    val displayValue: String? = null,
    val valueTotal: Money? = null,
    val condition: Condition? = null,
    val conditions: List<Condition> = emptyList(),
    val userId: Int? = null,
    val owners: List<AccountView> = emptyList(),
    val acquisitions: List<ValuationPurchaseView> = emptyList(),
    val storage: String? = null,
)

/** In which sets a part or a figure is contained; [header] describes the item itself. */
data class UsageView(
    val header: ComponentHeaderView? = null,
    val sets: List<UsingSetView> = emptyList(),
)

/** What the parts list asks the own stock for: Rebrickable number and color. */
data class PartialKey(val number: String, val color: Int)

/** How many pieces there are; [lose] counts only what is in no set. */
data class PartInventory(val total: Int = 0, val lose: Int = 0)

data class ValuationPurchaseView(
    val id: Int = 0,
    val condition: Condition = Condition.NEW,
    val quantity: Int = 1,
    val purchasePrice: Money? = null,
    val avgPrice: Money? = null,
    val totalAvg: String? = null,
    val valueTotal: Money? = null,
    val pnlPct: String? = null,
    val pnlPercent: Double? = null,
    val createdAt: Instant? = null,
)
