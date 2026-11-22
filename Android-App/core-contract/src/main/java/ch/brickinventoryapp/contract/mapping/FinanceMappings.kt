package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.DashboardStats
import ch.brickinventoryapp.contract.FigsValuationResponse
import ch.brickinventoryapp.contract.PartsValuationResponse
import ch.brickinventoryapp.contract.PnlResponse
import ch.brickinventoryapp.contract.PnlSetZeile
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
    purchasePricesForeignCurrency = kaufpreiseFremdeWaehrung,
)

fun FigsValuationResponse.asView() = FiguresValuationView(
    currency = currency,
    figs = figs.map { it.asView() },
    totalValue = totalValue,
    purchasePricesForeignCurrency = kaufpreiseFremdeWaehrung,
)

fun PnlResponse.asView() = ProfitView(
    currency = currency,
    totals = totals.asView(),
    sets = sets.map { it.asView() },
)

fun PnlSetZeile.asView() = GainRowView(
    setNumber = setNumber,
    quantity = quantity,
    currentPrice = currentPrice.asMoney(),
    baselinePrice = baselinePrice.asMoney(),
    pnlPct = pnlPct,
    baselinePnlPct = baselinePnlPct,
    pnlAmount = pnlBetrag.asMoney(),
    pnlPercent = pnlProzent,
    baselinePnlPercent = baselinePnlProzent,
    tilePrice = kachelPreis.asMoney(),
    tilePnlPct = kachelPnlPct,
    tileSource = kachelQuelle,
)

fun PnlTotals.asView() = GainSumsView(
    purchase = purchase,
    current = current,
    pnlPct = pnlPct,
    pnlPercent = pnlProzent,
    purchasePricesForeignCurrency = kaufpreiseFremdeWaehrung,
    grandTotal = grandTotal,
    positions = positionen,
    positionsValued = positionenBewertet,
    positionsWithoutMarketPrice = positionenOhneMarktpreis,
    positionsWithoutPurchasePrice = positionenOhneKaufpreis,
    basisCostBasis = basisEinstand,
    basisMarketValue = basisMarktwert,
    basisPnlAmount = basisGuvBetrag,
    withoutMarketPriceCostBasis = ohneMarktpreisEinstand,
    withoutPurchasePriceMarketValue = ohneKaufpreisMarktwert,
)

fun ValuationResponse.asView() = ValuationView(
    currency = currency,
    condition = condition,
    cacheTtlHours = ttlStunden,
    purchasePricesForeignCurrency = kaufpreiseFremdeWaehrung,
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
    valueTotal = wertGesamt.asMoney(),
    pnlPercent = pnlProzent,
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
