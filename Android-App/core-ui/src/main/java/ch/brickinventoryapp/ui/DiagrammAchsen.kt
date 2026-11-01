package ch.brickinventoryapp.ui

import ch.brickinventoryapp.ui.model.DiagrammAchse
import ch.brickinventoryapp.ui.model.DiagrammPunkt
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Currency
import java.util.Locale

/*
 * Achsenbeschriftung der Wertentwicklung in der Sprache der App. Der Server
 * wählt, WELCHE Punkte beschriftet werden, schreibt den Text aber fest in
 * Schweizer Form („03.10“, „CHF 1'234“); aus dem ISO-Tag derselben Antwort
 * (chart.x) entsteht hier „3. Okt.“ bzw. „Oct 3“.
 */

/** Monatsauflösung erkennt man an der Form „MM/YY“, die der Server dann schreibt. */
private val MONATLICH = Regex("""\d{2}/\d{2}""")

/** Kurzes Datum für die x-Achse, oder null, wenn [iso] kein Tag ist. */
fun achsenDatum(iso: String, monatlich: Boolean, locale: Locale): String? {
    val tag = runCatching { LocalDate.parse(iso.take(10)) }.getOrNull() ?: return null
    val muster = when {
        monatlich -> "MMM yy"
        locale.language == "en" -> "MMM d"
        else -> "d. MMM"
    }
    return DateTimeFormatter.ofPattern(muster, locale).format(tag)
}

/**
 * Ersetzt die Beschriftung jedes beschrifteten Punkts durch das lokale Datum.
 * Passen [tage] nicht Punkt für Punkt, bleibt der Text des Servers stehen.
 */
fun lokaleAchse(punkte: List<DiagrammPunkt>, tage: List<String>, locale: Locale): List<DiagrammPunkt> {
    if (tage.size != punkte.size) return punkte
    return punkte.mapIndexed { i, p ->
        if (p.xLabel.isBlank()) p
        else p.copy(xLabel = achsenDatum(tage[i], MONATLICH.matches(p.xLabel), locale) ?: p.xLabel)
    }
}

/** y-Achse als ganze Beträge in der Währung der Antwort, Tausender nach [locale]. */
fun lokaleWerte(achse: List<DiagrammAchse>, waehrung: String, locale: Locale): List<DiagrammAchse> {
    val nf = runCatching {
        NumberFormat.getCurrencyInstance(locale).apply {
            currency = Currency.getInstance(waehrung)
            maximumFractionDigits = 0
            minimumFractionDigits = 0
        }
    }.getOrNull() ?: return achse
    return achse.map { it.copy(label = nf.format(it.value)) }
}
