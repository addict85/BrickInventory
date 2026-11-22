package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.BrickColor
import ch.brickinventoryapp.contract.ChartPoint
import ch.brickinventoryapp.contract.ChartYAxis
import ch.brickinventoryapp.contract.CsvKind
import ch.brickinventoryapp.contract.PriceAlert
import ch.brickinventoryapp.contract.StartupStatus
import ch.brickinventoryapp.contract.Voucher
import ch.brickinventoryapp.model.domain.ChartAxis
import ch.brickinventoryapp.model.domain.ColorView
import ch.brickinventoryapp.model.domain.CsvImportKind
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.domain.PricePoint
import ch.brickinventoryapp.model.domain.StartStateView
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.model.domain.asMoney
import ch.brickinventoryapp.model.domain.asMoneyRequired
import ch.brickinventoryapp.model.util.parseInstant

fun CsvImportKind.asData(): CsvKind = when (this) {
    CsvImportKind.SETS -> CsvKind.SETS
    CsvImportKind.PARTS -> CsvKind.PARTS
    CsvImportKind.MINIFIGS -> CsvKind.MINIFIGS
    CsvImportKind.WANTED_LIST -> CsvKind.WANTED_LIST
    CsvImportKind.PRICE_ALARMS -> CsvKind.PRICE_ALARMS
}

fun CsvKind.asView(): CsvImportKind = CsvImportKind.valueOf(name)

fun StartupStatus.asView() = StartStateView(ready = ready, step = step, undercut = sub,
    progress = progress, total = total)

fun ChartPoint.asView() = PricePoint(xLabel, value.asMoneyRequired(), yFrac)

fun ChartYAxis.asView() = ChartAxis(label, value.asMoneyRequired(), frac)

fun BrickColor.asView() = ColorView(id, name, hex)

fun Voucher.asView() = VoucherView(id, number, pin, amount.asMoneyRequired(), currency, hasPdf,
    parseInstant(createdAt), parseInstant(balanceCheckedAt))

fun PriceAlert.asView() = PriceAlertView(setNumber, condition, direction, threshold.asMoneyRequired(), currencyCode,
    triggered, parseInstant(lastTriggeredAt), lastPrice.asMoney(), name, imageLocal, imageUrl, setImgUrl, owns)
