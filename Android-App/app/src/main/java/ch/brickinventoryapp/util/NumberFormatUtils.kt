package ch.brickinventoryapp.util

import androidx.appcompat.app.AppCompatDelegate
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * Zahlen und Beträge — EINE Fassung für die ganze App, gleichgezogen mit der
 * Webapp.
 *
 * ── Was vorher auseinanderlief ──────────────────────────────────────────────
 * Für denselben Betrag gab es drei Schreibweisen:
 *
 *   Webapp                Intl.NumberFormat(locale(), {style:'currency', …})
 *   App, Finanzreiter     "<Symbol> <Betrag>"      (Symbol VOR dem Betrag)
 *   App, überall sonst    "<Betrag> <Währung>"     (Code NACH dem Betrag)
 *
 * Dazu kam die Sprache: Die Webapp folgt der eingestellten UI-Sprache
 * (`locale()` in public/i18n.js liefert de-CH oder en-GB), die alte
 * `fmtSwissAmount()` nagelte de-CH fest. Ein englischsprachiger App-Nutzer sah
 * `1'234.50`, im Browser `1,234.50` — dieselbe Zahl, zwei Bilder.
 *
 * ── Die gemeinsame Regel ────────────────────────────────────────────────────
 * Dieselbe Zuordnung wie in der Webapp: Deutsch → de-CH (Apostroph als
 * Tausendertrennung, wie hier gewohnt), alles andere → en-GB. Und Beträge
 * laufen über die Währungs-Formatierung der Plattform statt über selbst
 * zusammengesetzte Zeichenketten — die Stellung von Symbol und Betrag
 * unterscheidet sich je Sprache, und genau das ist der Unterschied, den man
 * von Hand nicht trifft.
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
    // AppCompat-Zustand existiert. Ohne den Rückfall wäre die Formatierung im
    // Test nicht prüfbar — und genau das Prüfen des ERGEBNISSES (nicht nur der
    // Regel) war die Lehre aus Nachtrag 48.
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
