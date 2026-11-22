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
import ch.brickinventoryapp.model.domain.PriceChartView
import ch.brickinventoryapp.model.domain.PriceHistoryPointView
import ch.brickinventoryapp.model.domain.PriceHistoryView
import ch.brickinventoryapp.model.domain.PricePerStateView
import ch.brickinventoryapp.model.domain.PricePointView
import ch.brickinventoryapp.model.domain.PriceSeriesView
import ch.brickinventoryapp.model.domain.SetPriceView
import ch.brickinventoryapp.model.domain.StateValuationView
import ch.brickinventoryapp.model.domain.WantedItemPricesView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.domain.asMoneyRequired

fun PriceChartData.asView() = PriceChartView(
    values = values.map { it.asView() },
    x = x,
)

fun PriceChartSeries.asView() = PriceSeriesView(
    name = name,
    values = values.map { it.asView() },
    firstRealIndex = firstRealIndex,
)

fun PriceChartPoint.asView() = PricePointView(
    x = x,
    price = y.asMoneyRequired(),
)

fun PriceByCondition.asView() = PricePerStateView(
    new = new?.asView(),
    used = used?.asView(),
)

fun ConditionValuation.asView() = StateValuationView(
    marketPrice = marketPrice.asMoney(),
    purchasePrice = purchasePrice.asMoney(),
    pnlPct = pnlPct,
)

fun PriceHistoryResponse.asView() = PriceHistoryView(
    currency = currency,
    historyNew = historyNew.map { it.asView() },
    historyUsed = historyUsed.map { it.asView() },
    byCondition = byCondition.asView(),
    chart = chart.asView(),
    pnlPct = pnlPct,
    pnlPercent = pnlProzent,
    purchasePrice = purchasePrice.asMoney(),
)

fun PriceHistoryPoint.asView() = PriceHistoryPointView(
    qtyAvgPrice = qtyAvgPrice.asMoney(),
    avgPrice = avgPrice.asMoney(),
)

fun SetPriceResponse.asView() = SetPriceView(
    setNumber = setNumber,
    currency = currency,
    avgPrice = avgPrice.asMoney(),
    qtyAvgPrice = qtyAvgPrice.asMoney(),
    noPrice = noPrice,
)

fun CurrentPrice.asView() = CurrentPriceView(
    condition = condition,
    avgPrice = avgPrice.asMoney(),
)

fun CurrentByCondition.asView() = CurrentPerStateView(
    new = new?.asView(),
    used = used?.asView(),
)

fun MerkpostenPreiseResponse.asView() = WantedItemPricesView(
    currency = currency,
    current = current.asView(),
)
