package ch.brickinventoryapp.model.domain

import java.time.Instant

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

/** [teileGesamt] ist die Gesamtzahl wie in der Sammlung: aus Sets und einzeln erfasst zusammen. */
data class PartsMetricsView(
    val uniqueParts: Int = 0,
    val uniqueColors: Int = 0,
    val teileGesamt: Int = 0,
    val partsFromSets: Int? = null,
    val partsSingle: Int? = null,
)

data class FigurAnsicht(
    val figNumber: String,
    val condition: Zustand? = null,
    val conditions: List<Zustand> = emptyList(),
    val owners: List<AccountView> = emptyList(),
    val avgPurchasePrice: Geld? = null,
    val figName: String? = null,
    val quantity: Int = 1,
    val totalQuantity: Int? = null,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val source: Herkunft = Herkunft.SET,
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
    val colorId: Int = OHNE_FARBE,
    val colorName: String? = null,
    val colorHex: String? = null,
    val quantity: Int = 1,
    val imageUrl: String? = null,
    val imageLocal: String? = null,
    val unitPrice: Geld? = null,
    val purchasePrice: Geld? = null,
    val avgPurchasePrice: Geld? = null,
    val qtyAvgPrice: Geld? = null,
    val avgPrice: Geld? = null,
    val pnlPct: String? = null,
    val pnlProzent: Double? = null,
    val displayValue: String? = null,
    val wertGesamt: Geld? = null,
    val condition: Zustand? = null,
    val conditions: List<Zustand> = emptyList(),
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
    val unitPrice: Geld? = null,
    val purchasePrice: Geld? = null,
    val avgPurchasePrice: Geld? = null,
    val qtyAvgPrice: Geld? = null,
    val avgPrice: Geld? = null,
    val pnlPct: String? = null,
    val pnlProzent: Double? = null,
    val displayValue: String? = null,
    val wertGesamt: Geld? = null,
    val condition: Zustand? = null,
    val conditions: List<Zustand> = emptyList(),
    val userId: Int? = null,
    val owners: List<AccountView> = emptyList(),
    val acquisitions: List<ValuationPurchaseView> = emptyList(),
    val storage: String? = null,
)

/** In welchen Sets ein Teil oder eine Figur steckt; [kopf] beschreibt den Posten selbst. */
data class UsageView(
    val kopf: ComponentHeaderView? = null,
    val sets: List<UsingSetView> = emptyList(),
)

/** Wonach die Teileliste den eigenen Bestand fragt: Rebrickable-Nummer und Farbe. */
data class PartialKey(val nummer: String, val farbe: Int)

/** Wie viele Stück da sind; [lose] zählt nur, was in keinem Set steckt. */
data class PartInventory(val gesamt: Int = 0, val lose: Int = 0)

data class ValuationPurchaseView(
    val id: Int = 0,
    val condition: Zustand = Zustand.NEU,
    val quantity: Int = 1,
    val purchasePrice: Geld? = null,
    val avgPrice: Geld? = null,
    val totalAvg: String? = null,
    val wertGesamt: Geld? = null,
    val pnlPct: String? = null,
    val pnlProzent: Double? = null,
    val createdAt: Instant? = null,
)
