package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.ChartAxis
import ch.brickinventoryapp.model.domain.DiagrammPunkt
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Currency
import java.util.Locale
import ch.brickinventoryapp.model.util.DateYear
import ch.brickinventoryapp.model.util.fmtDatum
import ch.brickinventoryapp.ui.util.withCurrencyGap

/*
 * Axis labels of the value chart in the app's language. The server
 * chooses WHICH points get a label, but writes the text fixed in
 * Swiss form („03.10“, „CHF 1'234“); from the ISO day of the same response
 * (chart.x) this produces „03.10.“ resp. „03/10“ here — the same form as every other
 * date in the app (fmtDatum), just without the year.
 */

/** Monthly resolution is recognized by the form „MM/YY“, which the server then writes. */
private val MONTHLY = Regex("""\d{2}/\d{2}""")

/** Short date for the x-axis, or null if [iso] is not a day. */
fun axesDate(iso: String, monthly: Boolean, locale: Locale): String? {
    val tag = runCatching { LocalDate.parse(iso.take(10)) }.getOrNull() ?: return null
    if (!monthly) return fmtDatum(iso, locale, DateYear.OHNE)
    return DateTimeFormatter.ofPattern("MMM yy", locale).format(tag)
}

/**
 * Replaces the label of every labeled point with the local date.
 * If [days] doesn't match point for point, the server's text stays as it is.
 */
fun localAxis(punkte: List<DiagrammPunkt>, days: List<String>, locale: Locale): List<DiagrammPunkt> {
    if (days.size != punkte.size) return punkte
    return punkte.mapIndexed { i, p ->
        if (p.xLabel.isBlank()) p
        else p.copy(xLabel = axesDate(days[i], MONTHLY.matches(p.xLabel), locale) ?: p.xLabel)
    }
}

/**
 * y-axis as whole amounts in the response's currency, thousands per [locale].
 * [compact] for large text: „1,7k“ without a currency — written out, the axis
 * took up a third of the chart width at 200%; the amount sits in the header card above it.
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

/** An amount in at most four characters plus unit: 850, 1,7k, 12k, 1,2M. */
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
