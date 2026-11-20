package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.ConditionValuation
import ch.brickinventoryapp.contract.CurrentByCondition
import ch.brickinventoryapp.contract.CurrentPrice
import ch.brickinventoryapp.contract.MerkpostenPreiseResponse
import ch.brickinventoryapp.contract.PriceByCondition
import ch.brickinventoryapp.contract.PriceChartData
import ch.brickinventoryapp.contract.PriceChartPoint
import ch.brickinventoryapp.contract.PriceChartSeries
import ch.brickinventoryapp.contract.PriceHistoryPoint
import ch.brickinventoryapp.contract.PriceHistoryResponse
import ch.brickinventoryapp.contract.SetPriceResponse
import ch.brickinventoryapp.model.domain.CurrentPerStateView
import ch.brickinventoryapp.model.domain.CurrentPriceView
import ch.brickinventoryapp.model.domain.WantedItemPricesView
import ch.brickinventoryapp.model.domain.PreisDiagrammAnsicht
import ch.brickinventoryapp.model.domain.PricePerStateView
import ch.brickinventoryapp.model.domain.PricePointView
import ch.brickinventoryapp.model.domain.PriceSeriesView
import ch.brickinventoryapp.model.domain.PriceHistoryView
import ch.brickinventoryapp.model.domain.PriceHistoryPointView
import ch.brickinventoryapp.model.domain.SetPriceView
import ch.brickinventoryapp.model.domain.StateValuationView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.domain.asMoneyRequired

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
