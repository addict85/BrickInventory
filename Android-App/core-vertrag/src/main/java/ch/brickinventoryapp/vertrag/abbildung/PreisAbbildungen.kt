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
import ch.brickinventoryapp.model.fach.AktuellJeZustandAnsicht
import ch.brickinventoryapp.model.fach.AktuellerPreisAnsicht
import ch.brickinventoryapp.model.fach.MerkpostenPreiseAnsicht
import ch.brickinventoryapp.model.fach.PreisDiagrammAnsicht
import ch.brickinventoryapp.model.fach.PreisJeZustandAnsicht
import ch.brickinventoryapp.model.fach.PreisPunktAnsicht
import ch.brickinventoryapp.model.fach.PreisReiheAnsicht
import ch.brickinventoryapp.model.fach.PreisverlaufAnsicht
import ch.brickinventoryapp.model.fach.PreisverlaufPunktAnsicht
import ch.brickinventoryapp.model.fach.SetPreisAnsicht
import ch.brickinventoryapp.model.fach.ZustandsBewertungAnsicht
import ch.brickinventoryapp.model.fach.alsGeld
import ch.brickinventoryapp.model.fach.alsGeldPflicht

fun PriceChartData.alsAnsicht() = PreisDiagrammAnsicht(
    values = values.map { it.alsAnsicht() },
    x = x,
)

fun PriceChartSeries.alsAnsicht() = PreisReiheAnsicht(
    name = name,
    values = values.map { it.alsAnsicht() },
    firstRealIndex = firstRealIndex,
)

fun PriceChartPoint.alsAnsicht() = PreisPunktAnsicht(
    x = x,
    preis = y.alsGeldPflicht(),
)

fun PriceByCondition.alsAnsicht() = PreisJeZustandAnsicht(
    new = new?.alsAnsicht(),
    used = used?.alsAnsicht(),
)

fun ConditionValuation.alsAnsicht() = ZustandsBewertungAnsicht(
    marketPrice = marketPrice.alsGeld(),
    purchasePrice = purchasePrice.alsGeld(),
    pnlPct = pnlPct,
)

fun PriceHistoryResponse.alsAnsicht() = PreisverlaufAnsicht(
    currency = currency,
    historyNew = historyNew.map { it.alsAnsicht() },
    historyUsed = historyUsed.map { it.alsAnsicht() },
    byCondition = byCondition.alsAnsicht(),
    chart = chart.alsAnsicht(),
    pnlPct = pnlPct,
    pnlProzent = pnlProzent,
    purchasePrice = purchasePrice.alsGeld(),
)

fun PriceHistoryPoint.alsAnsicht() = PreisverlaufPunktAnsicht(
    qtyAvgPrice = qtyAvgPrice.alsGeld(),
    avgPrice = avgPrice.alsGeld(),
)

fun SetPriceResponse.alsAnsicht() = SetPreisAnsicht(
    setNumber = setNumber,
    currency = currency,
    avgPrice = avgPrice.alsGeld(),
    qtyAvgPrice = qtyAvgPrice.alsGeld(),
    noPrice = noPrice,
)

fun CurrentPrice.alsAnsicht() = AktuellerPreisAnsicht(
    condition = condition,
    avgPrice = avgPrice.alsGeld(),
)

fun CurrentByCondition.alsAnsicht() = AktuellJeZustandAnsicht(
    new = new?.alsAnsicht(),
    used = used?.alsAnsicht(),
)

fun MerkpostenPreiseResponse.alsAnsicht() = MerkpostenPreiseAnsicht(
    currency = currency,
    current = current.alsAnsicht(),
)
