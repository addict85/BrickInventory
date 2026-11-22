package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.BrickColor
import ch.brickinventoryapp.contract.ChartPoint
import ch.brickinventoryapp.contract.ChartYAxis
import ch.brickinventoryapp.contract.CsvKind
import ch.brickinventoryapp.contract.Gutschein
import ch.brickinventoryapp.contract.Preisalarm
import ch.brickinventoryapp.contract.StartupStatus
import ch.brickinventoryapp.model.domain.CsvImportKind
import ch.brickinventoryapp.model.domain.ChartAxis
import ch.brickinventoryapp.model.domain.DiagrammPunkt
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.domain.StartStateView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.domain.asMoneyRequired
import ch.brickinventoryapp.model.util.zeitpunkt

fun CsvImportKind.asData(): CsvKind = when (this) {
    CsvImportKind.SETS -> CsvKind.SETS
    CsvImportKind.TEILE -> CsvKind.TEILE
    CsvImportKind.MINIFIGUREN -> CsvKind.MINIFIGUREN
    CsvImportKind.MERKLISTE -> CsvKind.MERKLISTE
    CsvImportKind.PREISALARME -> CsvKind.PREISALARME
}

fun CsvKind.alsAnsicht(): CsvImportKind = CsvImportKind.valueOf(name)

fun StartupStatus.alsAnsicht() = StartStateView(bereit = ready, schritt = step, undercut = sub,
    fortschritt = progress, gesamt = total)

fun ChartPoint.alsAnsicht() = DiagrammPunkt(xLabel, value.asMoneyRequired(), yFrac)

fun ChartYAxis.alsAnsicht() = ChartAxis(label, value.asMoneyRequired(), frac)

fun BrickColor.alsAnsicht() = ColorView(id, name, hex)

fun Gutschein.alsAnsicht() = VoucherView(id, number, pin, amount.asMoneyRequired(), currency, hatPdf,
    zeitpunkt(createdAt), zeitpunkt(guthabenGeprueftAm))

fun Preisalarm.alsAnsicht() = PriceAlertView(setNumber, condition, direction, threshold.asMoneyRequired(), currencyCode,
    triggered, zeitpunkt(lastTriggeredAt), lastPrice.asMoney(), name, imageLocal, imageUrl, setImgUrl, besitzt)
