package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.DashboardStats
import ch.brickinventoryapp.vertrag.FigsValuationResponse
import ch.brickinventoryapp.vertrag.PartsValuationResponse
import ch.brickinventoryapp.vertrag.PnlResponse
import ch.brickinventoryapp.vertrag.PnlSetZeile
import ch.brickinventoryapp.vertrag.PnlTotals
import ch.brickinventoryapp.vertrag.Totals
import ch.brickinventoryapp.vertrag.ValuationResponse
import ch.brickinventoryapp.vertrag.ValuationSet
import ch.brickinventoryapp.model.ui.model.BewertungAnsicht
import ch.brickinventoryapp.model.ui.model.BewertungSetAnsicht
import ch.brickinventoryapp.model.ui.model.FigurenBewertungAnsicht
import ch.brickinventoryapp.model.ui.model.GewinnAnsicht
import ch.brickinventoryapp.model.ui.model.GewinnSummenAnsicht
import ch.brickinventoryapp.model.ui.model.GewinnZeileAnsicht
import ch.brickinventoryapp.model.ui.model.KennzahlenAnsicht
import ch.brickinventoryapp.model.ui.model.SummenAnsicht
import ch.brickinventoryapp.model.ui.model.TeileBewertungAnsicht

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
    kachelQuelle = kachelQuelle,
)

fun PnlTotals.alsAnsicht() = GewinnSummenAnsicht(
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

fun Totals.alsAnsicht() = SummenAnsicht(
    min = min,
    avg = avg,
    max = max,
)
