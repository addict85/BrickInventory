package ch.brickinventoryapp.util

import androidx.appcompat.app.AppCompatDelegate
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * Zahlen und Beträge — eine Fassung für die ganze App, gleichgezogen mit der
 * Webapp, damit derselbe Betrag überall gleich aussieht.
 *
 * Dieselbe Zuordnung wie in der Webapp (`locale()` in public/i18n.js): Deutsch →
 * de-CH (Apostroph als Tausendertrennung), alles andere → en-GB. Beträge laufen
 * über die Währungs-Formatierung der Plattform statt über selbst zusammengesetzte
 * Zeichenketten — die Stellung von Symbol und Betrag unterscheidet sich je
 * Sprache, und die trifft man von Hand nicht.
 */

/**
 * Zahlen-Locale zur eingestellten APP-Sprache — nicht zur Systemsprache.
 *
 * AppCompatDelegate ist dieselbe Quelle, aus der LanguageManager die Sprache
 * setzt; das System hält sie ab Android 13 selbst, darunter AppCompat. Ist
 * nichts gesetzt („System"), entscheidet die Systemsprache.
 */
fun appNumberLocale(): Locale {
    // try/catch, weil diese Funktion auch aus JVM-Unit-Tests läuft, wo kein
    // AppCompat-Zustand existiert. Ohne den Rückfall liesse sich im Test nur die Regel
    // prüfen, nicht das formatierte Ergebnis.
    val sprache = try {
        val locales = AppCompatDelegate.getApplicationLocales()
        if (locales.isEmpty) Locale.getDefault().language else locales[0]?.language
    } catch (_: Throwable) {
        Locale.getDefault().language
    }
    return if (sprache == "de") Locale.forLanguageTag("de-CH") else Locale.forLanguageTag("en-GB")
}

/**
 * Betrag MIT Währung — das Gegenstück zu fmtN() in public/js/01-core.js.
 *
 * @param currencyCode ISO-Code aus der Server-Antwort (CHF, EUR, …). Ein
 *        unbekannter Code darf die Anzeige nicht sprengen: dann steht der Code
 *        vor dem Betrag, wie es die Webapp bei fehlender Zuordnung auch tut.
 */
fun fmtMoney(amount: Double, currencyCode: String?): String {
    val loc = appNumberLocale()
    return try {
        val nf = NumberFormat.getCurrencyInstance(loc)
        nf.currency = Currency.getInstance(currencyCode ?: "EUR")
        nf.minimumFractionDigits = 2
        nf.maximumFractionDigits = 2
        nf.format(amount)
    } catch (_: Exception) {
        "${currencyCode.orEmpty()} ${fmtAmount(amount)}".trim()
    }
}

/** Wie fmtMoney, aber aus dem String der API — `null`/unlesbar ergibt „—". */
fun fmtMoneyOrDash(amount: String?, currencyCode: String?): String {
    val v = amount?.toDoubleOrNull() ?: return "—"
    return fmtMoney(v, currencyCode)
}

/** Betrag OHNE Währung — für Stellen, an denen die Währung schon danebensteht. */
fun fmtAmount(v: Double, minFractionDigits: Int = 2, maxFractionDigits: Int = 2): String {
    val nf = NumberFormat.getNumberInstance(appNumberLocale())
    nf.minimumFractionDigits = minFractionDigits
    nf.maximumFractionDigits = maxFractionDigits
    return nf.format(v)
}

/** Ganze Zahl mit Tausendertrennung (Stückzahlen, Teilezahlen). */
fun fmtInt(v: Int): String {
    val nf = NumberFormat.getNumberInstance(appNumberLocale())
    nf.maximumFractionDigits = 0
    return nf.format(v)
}

/**
 * Prozentzahl mit einer Nachkommastelle und Vorzeichen, sobald sie nicht null
 * ist — eine Fassung für Plaketten, Diagramm und Kacheln. [prozent] ist der
 * Wert in Prozent (12.5 heisst 12,5 %). Wo das Zeichen steht und ob mit
 * Abstand, entscheidet die Plattform für die App-Sprache.
 */
fun fmtProzent(prozent: Double): String {
    val nf = NumberFormat.getPercentInstance(appNumberLocale())
    nf.minimumFractionDigits = 1
    nf.maximumFractionDigits = 1
    // Erst runden: -0.04 hiesse sonst „-0.0 %“, ein Minus vor einer Null.
    val gerundet = Math.round(prozent * 10) / 10.0
    if (gerundet == 0.0) return nf.format(0.0)
    val text = nf.format(gerundet / 100.0)
    return if (gerundet > 0) "+$text" else text
}
