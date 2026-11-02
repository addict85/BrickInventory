package ch.brickinventoryapp.ui.model

import ch.brickinventoryapp.data.model.DashboardStats
import ch.brickinventoryapp.data.model.FigsValuationResponse
import ch.brickinventoryapp.data.model.PartsValuationResponse
import ch.brickinventoryapp.data.model.PnlResponse
import ch.brickinventoryapp.data.model.PnlSetZeile
import ch.brickinventoryapp.data.model.PnlTotals
import ch.brickinventoryapp.data.model.Totals
import ch.brickinventoryapp.data.model.ValuationResponse
import ch.brickinventoryapp.data.model.ValuationSet

// Bewertung, Gewinn und Kennzahlen; Beträge kommen fertig vom Server.

data class KennzahlenAnsicht(
    val totalSets: Int,
    val totalQuantity: Int,
    val totalInstructions: Int,
    val totalParts: Int,
    val totalMinifigs: Int,
    val teileAusSets: Int? = null,
    val teileEinzeln: Int? = null,
)

/** total_parts ist hier schon die Summe; set_parts fehlt bei älteren Servern, dann aus der Differenz. */
fun DashboardStats.alsAnsicht() = KennzahlenAnsicht(
    totalSets = totalSets,
    totalQuantity = totalQuantity,
    totalInstructions = totalInstructions,
    totalParts = totalParts,
    totalMinifigs = totalMinifigs,
    teileAusSets = setParts ?: manualParts?.let { totalParts - it },
    teileEinzeln = manualParts,
)

data class TeileBewertungAnsicht(
    val currency: String = "EUR",
    val parts: List<ManuellesTeilAnsicht> = emptyList(),
    val totalValue: String,
    val kaufpreiseFremdeWaehrung: Int = 0,
)

fun PartsValuationResponse.alsAnsicht() = TeileBewertungAnsicht(
    currency = currency,
    parts = parts.map { it.alsAnsicht() },
    totalValue = totalValue,
    kaufpreiseFremdeWaehrung = kaufpreiseFremdeWaehrung,
)

data class FigurenBewertungAnsicht(
    val currency: String = "EUR",
    val figs: List<ManuelleFigurAnsicht> = emptyList(),
    val totalValue: String,
    val kaufpreiseFremdeWaehrung: Int = 0,
)

fun FigsValuationResponse.alsAnsicht() = FigurenBewertungAnsicht(
    currency = currency,
    figs = figs.map { it.alsAnsicht() },
    totalValue = totalValue,
    kaufpreiseFremdeWaehrung = kaufpreiseFremdeWaehrung,
)

data class GewinnAnsicht(
    val currency: String = "EUR",
    val totals: GewinnSummenAnsicht,
    val sets: List<GewinnZeileAnsicht> = emptyList(),
)

fun PnlResponse.alsAnsicht() = GewinnAnsicht(
    currency = currency,
    totals = totals.alsAnsicht(),
    sets = sets.map { it.alsAnsicht() },
)

data class GewinnZeileAnsicht(
    val setNumber: String,
    val quantity: Int = 1,
    val currentPrice: Double? = null,
    val baselinePrice: Double? = null,
    val pnlPct: String? = null,
    val baselinePnlPct: String? = null,
    val pnlBetrag: Double? = null,
    val pnlProzent: Double? = null,
    val baselinePnlProzent: Double? = null,
    val kachelPreis: Double? = null,
    val kachelPnlPct: Double? = null,
)

fun PnlSetZeile.alsAnsicht() = GewinnZeileAnsicht(
    setNumber = setNumber,
    quantity = quantity,
    currentPrice = currentPrice,
    baselinePrice = baselinePrice,
    pnlPct = pnlPct,
    baselinePnlPct = baselinePnlPct,
    pnlBetrag = pnlBetrag,
    pnlProzent = pnlProzent,
    baselinePnlProzent = baselinePnlProzent,
    kachelPreis = kachelPreis,
    kachelPnlPct = kachelPnlPct,
)

data class GewinnSummenAnsicht(
    val purchase: String,
    val current: String,
    val pnlPct: String? = null,
    val pnlProzent: Double? = null,
    val kaufpreiseFremdeWaehrung: Int = 0,
    val grandTotal: String? = null,
)

fun PnlTotals.alsAnsicht() = GewinnSummenAnsicht(
    purchase = purchase,
    current = current,
    pnlPct = pnlPct,
    pnlProzent = pnlProzent,
    kaufpreiseFremdeWaehrung = kaufpreiseFremdeWaehrung,
    grandTotal = grandTotal,
)

data class BewertungAnsicht(
    val currency: String = "EUR",
    val condition: String = "N",
    val ttlStunden: Int? = null,
    val kaufpreiseFremdeWaehrung: Int = 0,
    val sets: List<BewertungSetAnsicht> = emptyList(),
    val totals: SummenAnsicht = SummenAnsicht(),
)

fun ValuationResponse.alsAnsicht() = BewertungAnsicht(
    currency = currency,
    condition = condition,
    ttlStunden = ttlStunden,
    kaufpreiseFremdeWaehrung = kaufpreiseFremdeWaehrung,
    sets = sets.map { it.alsAnsicht() },
    totals = totals.alsAnsicht(),
)

data class BewertungSetAnsicht(
    val setNumber: String,
    val addedAt: String? = null,
    val name: String? = null,
    val year: Int? = null,
    val quantity: Int = 1,
    val imageLocal: String? = null,
    val imageUrl: String? = null,
    val avgPrice: Double? = null,
    val qtyAvgPrice: Double? = null,
    val totalQtyAvg: String? = null,
    val totalAvg: String? = null,
    val wertGesamt: Double? = null,
    val pnlProzent: Double? = null,
    val purchasePrice: Double? = null,
    val noPrice: Boolean = false,
    val acquisitions: List<BewertungsKaufAnsicht> = emptyList(),
    val mixed: Boolean = false,
    /** Warum zu diesem Set kein Preis da ist; null, wenn es einen gibt. */
    val error: String? = null,
)

fun ValuationSet.alsAnsicht() = BewertungSetAnsicht(
    setNumber = setNumber,
    addedAt = addedAt,
    name = name,
    year = year,
    quantity = quantity,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    avgPrice = avgPrice,
    qtyAvgPrice = qtyAvgPrice,
    totalQtyAvg = totalQtyAvg,
    totalAvg = totalAvg,
    wertGesamt = wertGesamt,
    pnlProzent = pnlProzent,
    purchasePrice = purchasePrice,
    noPrice = noPrice,
    acquisitions = acquisitions.map { it.alsAnsicht() },
    mixed = mixed,
    error = error,
)

data class SummenAnsicht(
    val min: String = "0.00",
    val avg: String = "0.00",
    val max: String = "0.00",
)

fun Totals.alsAnsicht() = SummenAnsicht(
    min = min,
    avg = avg,
    max = max,
)
