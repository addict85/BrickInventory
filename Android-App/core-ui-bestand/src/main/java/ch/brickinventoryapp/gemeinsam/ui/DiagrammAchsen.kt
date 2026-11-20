package ch.brickinventoryapp.gemeinsam.ui

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.ChartAxis
import ch.brickinventoryapp.model.fach.DiagrammPunkt
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Currency
import java.util.Locale
import ch.brickinventoryapp.model.util.DateYear
import ch.brickinventoryapp.model.util.fmtDatum
import ch.brickinventoryapp.ui.util.withCurrencyGap

/*
 * Achsenbeschriftung der Wertentwicklung in der Sprache der App. Der Server
 * wählt, WELCHE Punkte beschriftet werden, schreibt den Text aber fest in
 * Schweizer Form („03.10“, „CHF 1'234“); aus dem ISO-Tag derselben Antwort
 * (chart.x) entsteht hier „03.10.“ bzw. „03/10“ — dieselbe Form wie jedes andere
 * Datum der App (fmtDatum), nur ohne Jahr.
 */

/** Monatsauflösung erkennt man an der Form „MM/YY“, die der Server dann schreibt. */
private val MONTHLY = Regex("""\d{2}/\d{2}""")

/** Kurzes Datum für die x-Achse, oder null, wenn [iso] kein Tag ist. */
fun axesDate(iso: String, monthly: Boolean, locale: Locale): String? {
    val tag = runCatching { LocalDate.parse(iso.take(10)) }.getOrNull() ?: return null
    if (!monthly) return fmtDatum(iso, locale, DateYear.OHNE)
    return DateTimeFormatter.ofPattern("MMM yy", locale).format(tag)
}

/**
 * Ersetzt die Beschriftung jedes beschrifteten Punkts durch das lokale Datum.
 * Passen [days] nicht Punkt für Punkt, bleibt der Text des Servers stehen.
 */
fun localAxis(punkte: List<DiagrammPunkt>, days: List<String>, locale: Locale): List<DiagrammPunkt> {
    if (days.size != punkte.size) return punkte
    return punkte.mapIndexed { i, p ->
        if (p.xLabel.isBlank()) p
        else p.copy(xLabel = axesDate(days[i], MONTHLY.matches(p.xLabel), locale) ?: p.xLabel)
    }
}

/**
 * y-Achse als ganze Beträge in der Währung der Antwort, Tausender nach [locale].
 * [compact] für grosse Schrift: „1,7k“ ohne Währung — ausgeschrieben nahm die Achse
 * bei 200 % ein Drittel der Diagrammbreite; der Betrag steht in der Kopfkarte darüber.
 */
fun localValues(axis: List<ChartAxis>, waehrung: Waehrung, locale: Locale, compact: Boolean = false): List<ChartAxis> {
    if (compact) return axis.map { it.copy(label = compactAmount(it.wert.asDouble(), locale)) }
    val nf = runCatching {
        NumberFormat.getCurrencyInstance(locale).apply {
            currency = Currency.getInstance(waehrung.code)
            maximumFractionDigits = 0
            minimumFractionDigits = 0
        }
    }.getOrNull() ?: return axis
    return axis.map { it.copy(label = withCurrencyGap(nf.format(it.wert.asBigDecimal()))) }
}

/** Ein Betrag in höchstens vier Zeichen und Einheit: 850, 1,7k, 12k, 1,2M. */
fun compactAmount(wert: Double, locale: Locale): String {
    val nf = NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1; minimumFractionDigits = 0 }
    val betrag = kotlin.math.abs(wert)
    return when {
        betrag >= 1_000_000 -> nf.format(wert / 1_000_000) + "M"
        betrag >= 10_000 -> nf.apply { maximumFractionDigits = 0 }.format(wert / 1_000) + "k"
        betrag >= 1_000 -> nf.format(wert / 1_000) + "k"
        else -> nf.apply { maximumFractionDigits = 0 }.format(wert)
    }
}
