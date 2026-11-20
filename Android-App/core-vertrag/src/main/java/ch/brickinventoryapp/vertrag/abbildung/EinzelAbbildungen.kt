package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.BrickColor
import ch.brickinventoryapp.vertrag.ChartPoint
import ch.brickinventoryapp.vertrag.ChartYAxis
import ch.brickinventoryapp.vertrag.CsvKind
import ch.brickinventoryapp.vertrag.Gutschein
import ch.brickinventoryapp.vertrag.Preisalarm
import ch.brickinventoryapp.vertrag.StartupStatus
import ch.brickinventoryapp.model.fach.CsvImportKind
import ch.brickinventoryapp.model.fach.ChartAxis
import ch.brickinventoryapp.model.fach.DiagrammPunkt
import ch.brickinventoryapp.model.fach.ColorView
import ch.brickinventoryapp.model.fach.VoucherView
import ch.brickinventoryapp.model.fach.PriceAlertView
import ch.brickinventoryapp.model.fach.StartStateView
import ch.brickinventoryapp.model.fach.asMoney
import ch.brickinventoryapp.model.fach.asMoneyRequired
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
