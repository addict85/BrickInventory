package ch.brickinventoryapp.model.ui.model

import ch.brickinventoryapp.model.data.model.ConditionValuation
import ch.brickinventoryapp.model.data.model.CurrentByCondition
import ch.brickinventoryapp.model.data.model.CurrentPrice
import ch.brickinventoryapp.model.data.model.MerkpostenPreiseResponse
import ch.brickinventoryapp.model.data.model.PriceByCondition
import ch.brickinventoryapp.model.data.model.PriceChartData
import ch.brickinventoryapp.model.data.model.PriceChartPoint
import ch.brickinventoryapp.model.data.model.PriceChartSeries
import ch.brickinventoryapp.model.data.model.PriceHistoryPoint
import ch.brickinventoryapp.model.data.model.PriceHistoryResponse
import ch.brickinventoryapp.model.data.model.SetPriceResponse

// Marktpreise und ihr Verlauf je Zustand.

data class PreisDiagrammAnsicht(
    val values: List<PreisReiheAnsicht> = emptyList(),
    val x: List<String> = emptyList(),
)

fun PriceChartData.alsAnsicht() = PreisDiagrammAnsicht(
    values = values.map { it.alsAnsicht() },
    x = x,
)

data class PreisReiheAnsicht(
    val name: String = "",
    val values: List<PreisPunktAnsicht> = emptyList(),
    val firstRealIndex: Int = 0,
)

fun PriceChartSeries.alsAnsicht() = PreisReiheAnsicht(
    name = name,
    values = values.map { it.alsAnsicht() },
    firstRealIndex = firstRealIndex,
)

data class PreisPunktAnsicht(
    val x: String = "",
    val y: Double = 0.0,
)

fun PriceChartPoint.alsAnsicht() = PreisPunktAnsicht(
    x = x,
    y = y,
)

data class PreisJeZustandAnsicht(
    val new: ZustandsBewertungAnsicht? = null,
    val used: ZustandsBewertungAnsicht? = null,
) {
    /** Die Zustände, zu denen es eine Bewertung gibt, neu zuerst. */
    fun present(): List<Pair<String, ZustandsBewertungAnsicht>> = buildList {
        new?.let { add("N" to it) }
        used?.let { add("U" to it) }
    }
}

fun PriceByCondition.alsAnsicht() = PreisJeZustandAnsicht(
    new = new?.alsAnsicht(),
    used = used?.alsAnsicht(),
)

data class ZustandsBewertungAnsicht(
    val marketPrice: Double? = null,
    val purchasePrice: Double? = null,
    val pnlPct: Double? = null,
)

fun ConditionValuation.alsAnsicht() = ZustandsBewertungAnsicht(
    marketPrice = marketPrice,
    purchasePrice = purchasePrice,
    pnlPct = pnlPct,
)

data class PreisverlaufAnsicht(
    val currency: String = "",
    val historyNew: List<PreisverlaufPunktAnsicht> = emptyList(),
    val historyUsed: List<PreisverlaufPunktAnsicht> = emptyList(),
    val byCondition: PreisJeZustandAnsicht = PreisJeZustandAnsicht(),
    val chart: PreisDiagrammAnsicht = PreisDiagrammAnsicht(),
    val pnlPct: String? = null,
    val pnlProzent: Double? = null,
    val purchasePrice: Double? = null,
)

fun PriceHistoryResponse.alsAnsicht() = PreisverlaufAnsicht(
    currency = currency,
    historyNew = historyNew.map { it.alsAnsicht() },
    historyUsed = historyUsed.map { it.alsAnsicht() },
    byCondition = byCondition.alsAnsicht(),
    chart = chart.alsAnsicht(),
    pnlPct = pnlPct,
    pnlProzent = pnlProzent,
    purchasePrice = purchasePrice,
)

data class PreisverlaufPunktAnsicht(
    val qtyAvgPrice: Double? = null,
    val avgPrice: Double? = null,
)

fun PriceHistoryPoint.alsAnsicht() = PreisverlaufPunktAnsicht(
    qtyAvgPrice = qtyAvgPrice,
    avgPrice = avgPrice,
)

data class SetPreisAnsicht(
    val setNumber: String = "",
    val currency: String = "",
    val avgPrice: Double? = null,
    val qtyAvgPrice: Double? = null,
    val noPrice: Boolean = false,
)

fun SetPriceResponse.alsAnsicht() = SetPreisAnsicht(
    setNumber = setNumber,
    currency = currency,
    avgPrice = avgPrice,
    qtyAvgPrice = qtyAvgPrice,
    noPrice = noPrice,
)

data class AktuellerPreisAnsicht(
    val condition: String = "",
    val avgPrice: Double? = null,
)

fun CurrentPrice.alsAnsicht() = AktuellerPreisAnsicht(
    condition = condition,
    avgPrice = avgPrice,
)

data class AktuellJeZustandAnsicht(
    val new: AktuellerPreisAnsicht? = null,
    val used: AktuellerPreisAnsicht? = null,
)

fun CurrentByCondition.alsAnsicht() = AktuellJeZustandAnsicht(
    new = new?.alsAnsicht(),
    used = used?.alsAnsicht(),
)

data class MerkpostenPreiseAnsicht(
    val currency: String = "",
    val current: AktuellJeZustandAnsicht = AktuellJeZustandAnsicht(),
)

fun MerkpostenPreiseResponse.alsAnsicht() = MerkpostenPreiseAnsicht(
    currency = currency,
    current = current.alsAnsicht(),
)
