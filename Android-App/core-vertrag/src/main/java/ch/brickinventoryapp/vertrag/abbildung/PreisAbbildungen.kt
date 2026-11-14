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
import ch.brickinventoryapp.model.ui.model.AktuellJeZustandAnsicht
import ch.brickinventoryapp.model.ui.model.AktuellerPreisAnsicht
import ch.brickinventoryapp.model.ui.model.MerkpostenPreiseAnsicht
import ch.brickinventoryapp.model.ui.model.PreisDiagrammAnsicht
import ch.brickinventoryapp.model.ui.model.PreisJeZustandAnsicht
import ch.brickinventoryapp.model.ui.model.PreisPunktAnsicht
import ch.brickinventoryapp.model.ui.model.PreisReiheAnsicht
import ch.brickinventoryapp.model.ui.model.PreisverlaufAnsicht
import ch.brickinventoryapp.model.ui.model.PreisverlaufPunktAnsicht
import ch.brickinventoryapp.model.ui.model.SetPreisAnsicht
import ch.brickinventoryapp.model.ui.model.ZustandsBewertungAnsicht

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
    y = y,
)

fun PriceByCondition.alsAnsicht() = PreisJeZustandAnsicht(
    new = new?.alsAnsicht(),
    used = used?.alsAnsicht(),
)

fun ConditionValuation.alsAnsicht() = ZustandsBewertungAnsicht(
    marketPrice = marketPrice,
    purchasePrice = purchasePrice,
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
    purchasePrice = purchasePrice,
)

fun PriceHistoryPoint.alsAnsicht() = PreisverlaufPunktAnsicht(
    qtyAvgPrice = qtyAvgPrice,
    avgPrice = avgPrice,
)

fun SetPriceResponse.alsAnsicht() = SetPreisAnsicht(
    setNumber = setNumber,
    currency = currency,
    avgPrice = avgPrice,
    qtyAvgPrice = qtyAvgPrice,
    noPrice = noPrice,
)

fun CurrentPrice.alsAnsicht() = AktuellerPreisAnsicht(
    condition = condition,
    avgPrice = avgPrice,
)

fun CurrentByCondition.alsAnsicht() = AktuellJeZustandAnsicht(
    new = new?.alsAnsicht(),
    used = used?.alsAnsicht(),
)

fun MerkpostenPreiseResponse.alsAnsicht() = MerkpostenPreiseAnsicht(
    currency = currency,
    current = current.alsAnsicht(),
)
