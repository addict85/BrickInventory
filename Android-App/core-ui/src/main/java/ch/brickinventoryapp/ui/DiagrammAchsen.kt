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
 * (chart.x) entsteht hier „03.10.“ bzw. „03/10“ — dieselbe Form wie jedes andere
 * Datum der App (fmtDatum), nur ohne Jahr.
 */

/** Monatsauflösung erkennt man an der Form „MM/YY“, die der Server dann schreibt. */
private val MONATLICH = Regex("""\d{2}/\d{2}""")

/** Kurzes Datum für die x-Achse, oder null, wenn [iso] kein Tag ist. */
fun achsenDatum(iso: String, monatlich: Boolean, locale: Locale): String? {
    val tag = runCatching { LocalDate.parse(iso.take(10)) }.getOrNull() ?: return null
    if (!monatlich) return ch.brickinventoryapp.util.fmtDatum(iso, locale, ch.brickinventoryapp.util.DatumJahr.OHNE)
    return DateTimeFormatter.ofPattern("MMM yy", locale).format(tag)
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

/**
 * y-Achse als ganze Beträge in der Währung der Antwort, Tausender nach [locale].
 * [kompakt] für grosse Schrift: „1,7k“ ohne Währung — ausgeschrieben nahm die Achse
 * bei 200 % ein Drittel der Diagrammbreite; der Betrag steht in der Kopfkarte darüber.
 */
fun lokaleWerte(achse: List<DiagrammAchse>, waehrung: String, locale: Locale, kompakt: Boolean = false): List<DiagrammAchse> {
    if (kompakt) return achse.map { it.copy(label = kompakterBetrag(it.value, locale)) }
    val nf = runCatching {
        NumberFormat.getCurrencyInstance(locale).apply {
            currency = Currency.getInstance(waehrung)
            maximumFractionDigits = 0
            minimumFractionDigits = 0
        }
    }.getOrNull() ?: return achse
    return achse.map { it.copy(label = ch.brickinventoryapp.util.mitWaehrungsAbstand(nf.format(it.value))) }
}

/** Ein Betrag in höchstens vier Zeichen und Einheit: 850, 1,7k, 12k, 1,2M. */
fun kompakterBetrag(wert: Double, locale: Locale): String {
    val nf = NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1; minimumFractionDigits = 0 }
    val betrag = kotlin.math.abs(wert)
    return when {
        betrag >= 1_000_000 -> nf.format(wert / 1_000_000) + "M"
        betrag >= 10_000 -> nf.apply { maximumFractionDigits = 0 }.format(wert / 1_000) + "k"
        betrag >= 1_000 -> nf.format(wert / 1_000) + "k"
        else -> nf.apply { maximumFractionDigits = 0 }.format(wert)
    }
}
