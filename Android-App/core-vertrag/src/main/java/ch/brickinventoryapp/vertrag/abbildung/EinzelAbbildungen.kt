package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.BrickColor
import ch.brickinventoryapp.vertrag.ChartPoint
import ch.brickinventoryapp.vertrag.ChartYAxis
import ch.brickinventoryapp.vertrag.CsvArt
import ch.brickinventoryapp.vertrag.Gutschein
import ch.brickinventoryapp.vertrag.Preisalarm
import ch.brickinventoryapp.vertrag.StartupStatus
import ch.brickinventoryapp.model.fach.CsvImportArt
import ch.brickinventoryapp.model.fach.DiagrammAchse
import ch.brickinventoryapp.model.fach.DiagrammPunkt
import ch.brickinventoryapp.model.fach.FarbeAnsicht
import ch.brickinventoryapp.model.fach.GutscheinAnsicht
import ch.brickinventoryapp.model.fach.PreisalarmAnsicht
import ch.brickinventoryapp.model.fach.StartzustandAnsicht
import ch.brickinventoryapp.model.fach.alsGeld
import ch.brickinventoryapp.model.fach.alsGeldPflicht
import ch.brickinventoryapp.model.util.zeitpunkt

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

fun ChartPoint.alsAnsicht() = DiagrammPunkt(xLabel, value.alsGeldPflicht(), yFrac)

fun ChartYAxis.alsAnsicht() = DiagrammAchse(label, value.alsGeldPflicht(), frac)

fun BrickColor.alsAnsicht() = FarbeAnsicht(id, name, hex)

fun Gutschein.alsAnsicht() = GutscheinAnsicht(id, number, pin, amount.alsGeldPflicht(), currency, hatPdf,
    zeitpunkt(createdAt), zeitpunkt(guthabenGeprueftAm))

fun Preisalarm.alsAnsicht() = PreisalarmAnsicht(setNumber, condition, direction, threshold.alsGeldPflicht(), currencyCode,
    triggered, zeitpunkt(lastTriggeredAt), lastPrice.alsGeld(), name, imageLocal, imageUrl, setImgUrl, besitzt)
