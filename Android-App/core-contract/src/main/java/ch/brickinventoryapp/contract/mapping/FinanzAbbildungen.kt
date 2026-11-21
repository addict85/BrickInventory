package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.model.domain.ValueHistoryView
import ch.brickinventoryapp.contract.PortfolioHistoryResponse

import ch.brickinventoryapp.contract.DashboardStats
import ch.brickinventoryapp.contract.FigsValuationResponse
import ch.brickinventoryapp.contract.PartsValuationResponse
import ch.brickinventoryapp.contract.PnlResponse
import ch.brickinventoryapp.contract.PnlSetZeile
import ch.brickinventoryapp.contract.PnlTotals
import ch.brickinventoryapp.contract.Totals
import ch.brickinventoryapp.contract.ValuationResponse
import ch.brickinventoryapp.contract.ValuationSet
import ch.brickinventoryapp.model.domain.BewertungAnsicht
import ch.brickinventoryapp.model.domain.ValuationSetView
import ch.brickinventoryapp.model.domain.FigurenBewertungAnsicht
import ch.brickinventoryapp.model.domain.GewinnAnsicht
import ch.brickinventoryapp.model.domain.GainSumsView
import ch.brickinventoryapp.model.domain.GainRowView
import ch.brickinventoryapp.model.domain.MetricsView
import ch.brickinventoryapp.model.domain.SumsView
import ch.brickinventoryapp.model.domain.TeileBewertungAnsicht
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.util.zeitpunkt

/** total_parts is already the sum here; set_parts is missing on older servers, then from the difference. */
fun DashboardStats.alsAnsicht() = MetricsView(
    totalSets = totalSets,
    totalQuantity = totalQuantity,
    totalInstructions = totalInstructions,
    totalParts = totalParts,
    totalMinifigs = totalMinifigs,
    partsFromSets = setParts ?: manualParts?.let { totalParts - it },
    partsSingle = manualParts,
)

fun PartsValuationResponse.alsAnsicht() = TeileBewertungAnsicht(
    currency = currency,
    parts = parts.map { it.alsAnsicht() },
    totalValue = totalValue,
    kaufpreiseFremdeWaehrung = kaufpreiseFremdeWaehrung,
)

fun FigsValuationResponse.alsAnsicht() = FigurenBewertungAnsicht(
    currency = currency,
    figs = figs.map { it.alsAnsicht() },
    totalValue = totalValue,
    kaufpreiseFremdeWaehrung = kaufpreiseFremdeWaehrung,
)

fun PnlResponse.alsAnsicht() = GewinnAnsicht(
    currency = currency,
    totals = totals.alsAnsicht(),
    sets = sets.map { it.alsAnsicht() },
)

fun PnlSetZeile.alsAnsicht() = GainRowView(
    setNumber = setNumber,
    quantity = quantity,
    currentPrice = currentPrice.asMoney(),
    baselinePrice = baselinePrice.asMoney(),
    pnlPct = pnlPct,
    baselinePnlPct = baselinePnlPct,
    pnlBetrag = pnlBetrag.asMoney(),
    pnlProzent = pnlProzent,
    baselinePnlProzent = baselinePnlProzent,
    kachelPreis = kachelPreis.asMoney(),
    kachelPnlPct = kachelPnlPct,
    kachelQuelle = kachelQuelle,
)

fun PnlTotals.alsAnsicht() = GainSumsView(
    purchase = purchase,
    current = current,
    pnlPct = pnlPct,
    pnlProzent = pnlProzent,
    kaufpreiseFremdeWaehrung = kaufpreiseFremdeWaehrung,
    grandTotal = grandTotal,
    positionen = positionen,
    positionenBewertet = positionenBewertet,
    positionenOhneMarktpreis = positionenOhneMarktpreis,
    positionenOhneKaufpreis = positionenOhneKaufpreis,
    basisEinstand = basisEinstand,
    basisMarktwert = basisMarktwert,
    basisGuvBetrag = basisGuvBetrag,
    ohneMarktpreisEinstand = ohneMarktpreisEinstand,
    ohneKaufpreisMarktwert = ohneKaufpreisMarktwert,
)

fun ValuationResponse.alsAnsicht() = BewertungAnsicht(
    currency = currency,
    condition = condition,
    ttlStunden = ttlStunden,
    kaufpreiseFremdeWaehrung = kaufpreiseFremdeWaehrung,
    sets = sets.map { it.alsAnsicht() },
    totals = totals.alsAnsicht(),
)

fun ValuationSet.alsAnsicht() = ValuationSetView(
    setNumber = setNumber,
    addedAt = zeitpunkt(addedAt),
    name = name,
    year = year,
    quantity = quantity,
    imageLocal = imageLocal,
    imageUrl = imageUrl,
    avgPrice = avgPrice.asMoney(),
    qtyAvgPrice = qtyAvgPrice.asMoney(),
    totalQtyAvg = totalQtyAvg,
    totalAvg = totalAvg,
    wertGesamt = wertGesamt.asMoney(),
    pnlProzent = pnlProzent,
    purchasePrice = purchasePrice.asMoney(),
    noPrice = noPrice,
    acquisitions = acquisitions.map { it.alsAnsicht() },
    mixed = mixed,
    error = error,
)

fun Totals.alsAnsicht() = SumsView(
    min = min,
    avg = avg,
    max = max,
)

fun PortfolioHistoryResponse.alsAnsicht() = ValueHistoryView(
    waehrung = currency,
    changePercent = periodChangePct,
    punkte = points.map { it.alsAnsicht() },
    yAchse = yAxis.map { it.alsAnsicht() },
    days = chart?.x.orEmpty(),
)
