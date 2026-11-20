package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.model.fach.ValueHistoryView
import ch.brickinventoryapp.vertrag.PortfolioHistoryResponse

import ch.brickinventoryapp.vertrag.DashboardStats
import ch.brickinventoryapp.vertrag.FigsValuationResponse
import ch.brickinventoryapp.vertrag.PartsValuationResponse
import ch.brickinventoryapp.vertrag.PnlResponse
import ch.brickinventoryapp.vertrag.PnlSetZeile
import ch.brickinventoryapp.vertrag.PnlTotals
import ch.brickinventoryapp.vertrag.Totals
import ch.brickinventoryapp.vertrag.ValuationResponse
import ch.brickinventoryapp.vertrag.ValuationSet
import ch.brickinventoryapp.model.fach.BewertungAnsicht
import ch.brickinventoryapp.model.fach.ValuationSetView
import ch.brickinventoryapp.model.fach.FigurenBewertungAnsicht
import ch.brickinventoryapp.model.fach.GewinnAnsicht
import ch.brickinventoryapp.model.fach.GainSumsView
import ch.brickinventoryapp.model.fach.GainRowView
import ch.brickinventoryapp.model.fach.MetricsView
import ch.brickinventoryapp.model.fach.SumsView
import ch.brickinventoryapp.model.fach.TeileBewertungAnsicht
import ch.brickinventoryapp.model.fach.asMoney
import ch.brickinventoryapp.model.util.zeitpunkt

/** total_parts ist hier schon die Summe; set_parts fehlt bei älteren Servern, dann aus der Differenz. */
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
