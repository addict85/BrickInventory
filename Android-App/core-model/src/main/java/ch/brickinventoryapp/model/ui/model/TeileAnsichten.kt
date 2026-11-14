package ch.brickinventoryapp.model.ui.model

import ch.brickinventoryapp.model.fach.Zustand

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
data class TeileKennzahlenAnsicht(
    val uniqueParts: Int = 0,
    val uniqueColors: Int = 0,
    val teileGesamt: Int = 0,
    val teileAusSets: Int? = null,
    val teileEinzeln: Int? = null,
)

data class FigurAnsicht(
    val figNumber: String,
    val condition: Zustand? = null,
    val conditions: List<Zustand> = emptyList(),
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

data class FigurenKennzahlenAnsicht(
    val types: Int = 0,
    val totalQuantity: Int = 0,
    val manual: Int = 0,
)

data class FilterFarbeAnsicht(
    val colorName: String? = null,
    val colorHex: String? = null,
    val uniqueParts: Int = 0,
    val totalQuantity: Int = 0,
)

data class KategorieAnsicht(
    val categoryName: String? = null,
    val label: String? = null,
    val uniqueParts: Int = 0,
    val totalQuantity: Int = 0,
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

data class VerwendendesSetAnsicht(
    val setNumber: String,
    val setName: String? = null,
    val quantity: Int = 0,
    val imageLocal: String? = null,
    val imageUrl: String? = null,
    val ownerUserId: Int = 0,
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
    val condition: Zustand? = null,
    val conditions: List<Zustand> = emptyList(),
    val userId: Int? = null,
    val owners: List<KontoAnsicht> = emptyList(),
    val acquisitions: List<BewertungsKaufAnsicht> = emptyList(),
    val storage: String? = null,
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
    val condition: Zustand? = null,
    val conditions: List<Zustand> = emptyList(),
    val userId: Int? = null,
    val owners: List<KontoAnsicht> = emptyList(),
    val acquisitions: List<BewertungsKaufAnsicht> = emptyList(),
    val storage: String? = null,
)

data class BewertungsKaufAnsicht(
    val id: Int = 0,
    val condition: Zustand = Zustand.NEU,
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
