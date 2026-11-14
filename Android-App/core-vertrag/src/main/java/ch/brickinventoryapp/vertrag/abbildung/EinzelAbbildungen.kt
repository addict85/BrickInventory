package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.BrickColor
import ch.brickinventoryapp.vertrag.ChartPoint
import ch.brickinventoryapp.vertrag.ChartYAxis
import ch.brickinventoryapp.vertrag.CsvArt
import ch.brickinventoryapp.vertrag.Gutschein
import ch.brickinventoryapp.vertrag.Preisalarm
import ch.brickinventoryapp.vertrag.StartupStatus
import ch.brickinventoryapp.model.ui.model.CsvImportArt
import ch.brickinventoryapp.model.ui.model.DiagrammAchse
import ch.brickinventoryapp.model.ui.model.DiagrammPunkt
import ch.brickinventoryapp.model.ui.model.FarbeAnsicht
import ch.brickinventoryapp.model.ui.model.GutscheinAnsicht
import ch.brickinventoryapp.model.ui.model.PreisalarmAnsicht
import ch.brickinventoryapp.model.ui.model.StartzustandAnsicht

fun CsvImportArt.alsDaten(): CsvArt = when (this) {
    CsvImportArt.SETS -> CsvArt.SETS
    CsvImportArt.TEILE -> CsvArt.TEILE
    CsvImportArt.MINIFIGUREN -> CsvArt.MINIFIGUREN
    CsvImportArt.MERKLISTE -> CsvArt.MERKLISTE
    CsvImportArt.PREISALARME -> CsvArt.PREISALARME
}

fun CsvArt.alsAnsicht(): CsvImportArt = CsvImportArt.valueOf(name)

fun StartupStatus.alsAnsicht() = StartzustandAnsicht(bereit = ready, schritt = step, unterschritt = sub,
    fortschritt = progress, gesamt = total)

fun ChartPoint.alsAnsicht() = DiagrammPunkt(xLabel, value, yFrac)

fun ChartYAxis.alsAnsicht() = DiagrammAchse(label, value, frac)

fun BrickColor.alsAnsicht() = FarbeAnsicht(id, name, hex)

fun Gutschein.alsAnsicht() = GutscheinAnsicht(id, number, pin, amount, currency, hatPdf, createdAt, guthabenGeprueftAm)

fun Preisalarm.alsAnsicht() = PreisalarmAnsicht(setNumber, condition, richtung, schwelle, currencyCode, ausgeloest,
    zuletztAm, zuletztPreis, name, imageLocal, imageUrl, setImgUrl, besitzt)
