package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.DashboardStats
import ch.brickinventoryapp.contract.FigsValuationResponse
import ch.brickinventoryapp.contract.PartsValuationResponse
import ch.brickinventoryapp.contract.PnlResponse
import ch.brickinventoryapp.contract.PnlSetRow
import ch.brickinventoryapp.contract.PnlTotals
import ch.brickinventoryapp.contract.PortfolioHistoryResponse
import ch.brickinventoryapp.contract.Totals
import ch.brickinventoryapp.contract.ValuationResponse
import ch.brickinventoryapp.contract.ValuationSet
import ch.brickinventoryapp.model.domain.FiguresValuationView
import ch.brickinventoryapp.model.domain.GainRowView
import ch.brickinventoryapp.model.domain.GainSumsView
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.model.domain.PartsValuationView
import ch.brickinventoryapp.model.domain.ProfitView
import ch.brickinventoryapp.model.domain.SumsView
import ch.brickinventoryapp.model.domain.ValuationSetView
import ch.brickinventoryapp.model.domain.ValuationView
import ch.brickinventoryapp.model.domain.ValueHistoryView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.util.parseInstant

/** total_parts is already the sum here; set_parts is missing on older servers, then from the difference. */
fun DashboardStats.asView() = MetricsView(
    totalSets = totalSets,
    totalQuantity = totalQuantity,
    totalInstructions = totalInstructions,
    totalParts = totalParts,
    totalMinifigs = totalMinifigs,
    partsFromSets = setParts ?: manualParts?.let { totalParts - it },
    partsSingle = manualParts,
)

fun PartsValuationResponse.asView() = PartsValuationView(
    currency = currency,
    parts = parts.map { it.asView() },
    totalValue = totalValue,
    purchasePricesForeignCurrency = foreignCurrencyPurchases,
)

fun FigsValuationResponse.asView() = FiguresValuationView(
    currency = currency,
    figs = figs.map { it.asView() },
    totalValue = totalValue,
    purchasePricesForeignCurrency = foreignCurrencyPurchases,
)

fun PnlResponse.asView() = ProfitView(
    currency = currency,
    totals = totals.asView(),
    sets = sets.map { it.asView() },
)

fun PnlSetRow.asView() = GainRowView(
    setNumber = setNumber,
    quantity = quantity,
    currentPrice = currentPrice.asMoney(),
    baselinePrice = baselinePrice.asMoney(),
    pnlPct = pnlPct,
    baselinePnlPct = baselinePnlPct,
    pnlAmount = pnlAmount.asMoney(),
    pnlPercent = pnlPercent,
    baselinePnlPercent = baselinePnlPercent,
    tilePrice = tilePrice.asMoney(),
    tilePnlPct = tilePnlPct,
    tileSource = tileSource,
)

fun PnlTotals.asView() = GainSumsView(
    purchase = purchase,
    current = current,
    pnlPct = pnlPct,
    pnlPercent = pnlPercent,
    purchasePricesForeignCurrency = foreignCurrencyPurchases,
    grandTotal = grandTotal,
    positions = positions,
    positionsValued = positionsValued,
    positionsWithoutMarketPrice = positionsWithoutMarketPrice,
    positionsWithoutPurchasePrice = positionsWithoutPurchasePrice,
    basisCostBasis = baselineCost,
    basisMarketValue = baselineMarketValue,
    basisPnlAmount = baselinePnlAmount,
    withoutMarketPriceCostBasis = costWithoutMarketPrice,
    withoutPurchasePriceMarketValue = marketValueWithoutPurchasePrice,
)

fun ValuationResponse.asView() = ValuationView(
    currency = currency,
    condition = condition,
    cacheTtlHours = cacheTtlHours,
    purchasePricesForeignCurrency = foreignCurrencyPurchases,
    sets = sets.map { it.asView() },
    totals = totals.asView(),
)

fun ValuationSet.asView() = ValuationSetView(
    setNumber = setNumber,
    addedAt = parseInstant(addedAt),
    name = name,
    year = year,
    quantity = quantity,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    avgPrice = avgPrice.asMoney(),
    qtyAvgPrice = qtyAvgPrice.asMoney(),
    totalQtyAvg = totalQtyAvg,
    totalAvg = totalAvg,
    valueTotal = valueTotal.asMoney(),
    pnlPercent = pnlPercent,
    purchasePrice = purchasePrice.asMoney(),
    noPrice = noPrice,
    acquisitions = acquisitions.map { it.asView() },
    mixed = mixed,
    error = error,
)

fun Totals.asView() = SumsView(
    min = min,
    avg = avg,
    max = max,
)

fun PortfolioHistoryResponse.asView() = ValueHistoryView(
    currency = currency,
    changePercent = periodChangePct,
    points = points.map { it.asView() },
    yAxis = yAxis.map { it.asView() },
    days = chart?.x.orEmpty(),
)
