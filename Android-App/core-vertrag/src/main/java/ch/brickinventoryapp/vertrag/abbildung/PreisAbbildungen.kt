package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.ConditionValuation
import ch.brickinventoryapp.vertrag.CurrentByCondition
import ch.brickinventoryapp.vertrag.CurrentPrice
import ch.brickinventoryapp.vertrag.MerkpostenPreiseResponse
import ch.brickinventoryapp.vertrag.PriceByCondition
import ch.brickinventoryapp.vertrag.PriceChartData
import ch.brickinventoryapp.vertrag.PriceChartPoint
import ch.brickinventoryapp.vertrag.PriceChartSeries
import ch.brickinventoryapp.vertrag.PriceHistoryPoint
import ch.brickinventoryapp.vertrag.PriceHistoryResponse
import ch.brickinventoryapp.vertrag.SetPriceResponse
import ch.brickinventoryapp.model.fach.CurrentPerStateView
import ch.brickinventoryapp.model.fach.CurrentPriceView
import ch.brickinventoryapp.model.fach.WantedItemPricesView
import ch.brickinventoryapp.model.fach.PreisDiagrammAnsicht
import ch.brickinventoryapp.model.fach.PricePerStateView
import ch.brickinventoryapp.model.fach.PricePointView
import ch.brickinventoryapp.model.fach.PriceSeriesView
import ch.brickinventoryapp.model.fach.PriceHistoryView
import ch.brickinventoryapp.model.fach.PriceHistoryPointView
import ch.brickinventoryapp.model.fach.SetPriceView
import ch.brickinventoryapp.model.fach.StateValuationView
import ch.brickinventoryapp.model.fach.asMoney
import ch.brickinventoryapp.model.fach.asMoneyRequired

fun PriceChartData.alsAnsicht() = PreisDiagrammAnsicht(
    values = values.map { it.alsAnsicht() },
    x = x,
)

fun PriceChartSeries.alsAnsicht() = PriceSeriesView(
    name = name,
    values = values.map { it.alsAnsicht() },
    firstRealIndex = firstRealIndex,
)

fun PriceChartPoint.alsAnsicht() = PricePointView(
    x = x,
    preis = y.asMoneyRequired(),
)

fun PriceByCondition.alsAnsicht() = PricePerStateView(
    new = new?.alsAnsicht(),
    used = used?.alsAnsicht(),
)

fun ConditionValuation.alsAnsicht() = StateValuationView(
    marketPrice = marketPrice.asMoney(),
    purchasePrice = purchasePrice.asMoney(),
    pnlPct = pnlPct,
)

fun PriceHistoryResponse.alsAnsicht() = PriceHistoryView(
    currency = currency,
    historyNew = historyNew.map { it.alsAnsicht() },
    historyUsed = historyUsed.map { it.alsAnsicht() },
    byCondition = byCondition.alsAnsicht(),
    chart = chart.alsAnsicht(),
    pnlPct = pnlPct,
    pnlProzent = pnlProzent,
    purchasePrice = purchasePrice.asMoney(),
)

fun PriceHistoryPoint.alsAnsicht() = PriceHistoryPointView(
    qtyAvgPrice = qtyAvgPrice.asMoney(),
    avgPrice = avgPrice.asMoney(),
)

fun SetPriceResponse.alsAnsicht() = SetPriceView(
    setNumber = setNumber,
    currency = currency,
    avgPrice = avgPrice.asMoney(),
    qtyAvgPrice = qtyAvgPrice.asMoney(),
    noPrice = noPrice,
)

fun CurrentPrice.alsAnsicht() = CurrentPriceView(
    condition = condition,
    avgPrice = avgPrice.asMoney(),
)

fun CurrentByCondition.alsAnsicht() = CurrentPerStateView(
    new = new?.alsAnsicht(),
    used = used?.alsAnsicht(),
)

fun MerkpostenPreiseResponse.alsAnsicht() = WantedItemPricesView(
    currency = currency,
    current = current.alsAnsicht(),
)
